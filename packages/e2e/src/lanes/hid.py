import asyncio
import json
import logging
import sys
from contextlib import aclosing

from idb.common.types import (
    IdbException,
    QuiescenceState,
    QuiescenceStateChanged,
    QuiescenceTargetExited,
    TCPAddress,
)
from idb.grpc.client import Client
from idb.grpc.idb_pb2 import LaunchRequest


def receipt(command, value=None):
    print(json.dumps({"id": command["id"], "value": value}), flush=True)


async def launch(client, bundle):
    pid = None
    async with client.stub.launch.open() as stream:
        await stream.send_message(
            LaunchRequest(start=LaunchRequest.Start(bundle_id=bundle, foreground_if_running=True))
        )
        await stream.end()
        async for response in stream:
            if response.debugger.pid > 0:
                pid = response.debugger.pid
    if pid is None:
        raise RuntimeError("the companion returned no application PID")
    return pid


async def quiet(client, pid):
    try:
        async with aclosing(client.accessibility_quiescence(pid=pid)) as states:
            async for event in states:
                if isinstance(event, QuiescenceTargetExited):
                    raise RuntimeError(f"application {pid} exited before it went quiet")
                if isinstance(event, QuiescenceStateChanged) and event.state == QuiescenceState.QUIET:
                    return {"state": "quiet"}
        raise RuntimeError("the native quiescence stream ended without a quiet state")
    except IdbException as error:
        if error.retry is None:
            raise
        return {"retry": error.retry.verdict, "reason": error.retry.reason, "message": str(error)}


async def main():
    reader = asyncio.StreamReader()
    await asyncio.get_running_loop().connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), sys.stdin
    )
    async with Client.build(
        TCPAddress("127.0.0.1", int(sys.argv[1])),
        logging.getLogger("e2e.hid"),
        exchange_metadata=False,
    ) as client:
        while line := await reader.readline():
            command = json.loads(line)
            phase = command["phase"]
            if phase == "launch":
                receipt(command, await launch(client, command["bundle"]))
            elif phase == "quiet":
                receipt(command, await quiet(client, command["pid"]))
            else:
                raise ValueError("unknown native input phase: " + phase)


asyncio.run(main())
