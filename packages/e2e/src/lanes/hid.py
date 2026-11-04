import asyncio
import json
import logging
import math
import sys
from contextlib import aclosing

from idb.common.types import (
    HIDDirection,
    HIDPress,
    HIDTouch,
    IdbException,
    Point,
    QuiescenceState,
    QuiescenceStateChanged,
    QuiescenceTargetExited,
    TCPAddress,
)
from idb.grpc.client import Client
from idb.grpc.idb_pb2 import LaunchRequest

STEP = 5.0
INTERVAL = 1 / 120


def sample(x, y, direction=HIDDirection.DOWN):
    return HIDPress(action=HIDTouch(point=Point(x=x, y=y)), direction=direction)


def receipt(command, value=None):
    print(json.dumps({"id": command["id"], "value": value}), flush=True)


async def events(reader, command, terminal):
    last = None
    while True:
        if command is None:
            line = await reader.readline()
            if not line:
                raise EOFError("touch input ended without an explicit release")
            command = json.loads(line)
        phase = command["phase"]
        if phase == "swipe":
            end = command["to"]
            origin, target = last, (end["x"], end["y"])
            resolution = math.ceil(math.dist(origin, target) / command["delta"])
            cadence = math.floor(command["duration"] / INTERVAL)
            steps = max(2, min(resolution, cadence))
            interval = command["duration"] / steps
            loop = asyncio.get_running_loop()
            began = loop.time()
            for index in range(1, steps + 1):
                remaining = began + interval * index - loop.time()
                if remaining > 0:
                    await asyncio.sleep(remaining)
                fraction = index / steps
                yield sample(
                    origin[0] + (target[0] - origin[0]) * fraction,
                    origin[1] + (target[1] - origin[1]) * fraction,
                )
            remaining = began + interval * (steps + 1) - loop.time()
            if remaining > 0:
                await asyncio.sleep(remaining)
            yield sample(*target, HIDDirection.UP)
            terminal.update(command)
            return
        x, y = command["x"], command["y"]
        if phase == "press":
            yield sample(x, y)
        elif phase == "move":
            steps = max(2, math.ceil(math.dist(last, (x, y)) / STEP) * 2)
            for index in range(1, steps + 1):
                await asyncio.sleep(INTERVAL)
                t = index / steps
                eased = t * t * t * (t * (t * 6 - 15) + 10)
                yield sample(last[0] + (x - last[0]) * eased, last[1] + (y - last[1]) * eased)
        elif phase == "release":
            yield sample(x, y, HIDDirection.UP)
            terminal.update(command)
            return
        else:
            raise ValueError("unknown touch phase: " + phase)
        last = (x, y)
        receipt(command)
        command = None


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
            if phase == "press":
                terminal = {}
                await client.hid(events(reader, command, terminal))
                receipt(terminal)
            elif phase == "launch":
                receipt(command, await launch(client, command["bundle"]))
            elif phase == "quiet":
                receipt(command, await quiet(client, command["pid"]))
            elif phase == "tap":
                await client.tap(command["x"], command["y"])
                receipt(command)
            else:
                raise ValueError("unknown native input phase: " + phase)


asyncio.run(main())
