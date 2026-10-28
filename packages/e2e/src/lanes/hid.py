import asyncio
import json
import logging
import sys

from idb.common.types import HIDDirection, HIDPress, HIDTouch, Point, TCPAddress
from idb.grpc.client import Client


async def events():
    reader = asyncio.StreamReader()
    await asyncio.get_running_loop().connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), sys.stdin
    )
    while line := await reader.readline():
        command = json.loads(line)
        phase = command["phase"]
        if phase not in ("press", "move", "release"):
            raise ValueError("unknown touch phase: " + phase)
        yield HIDPress(
            action=HIDTouch(point=Point(x=command["x"], y=command["y"])),
            direction=HIDDirection.UP if phase == "release" else HIDDirection.DOWN,
        )
        print(json.dumps({"id": command["id"]}), flush=True)
        if phase == "release":
            return
    raise EOFError("touch input ended without an explicit release")


async def main():
    async with Client.build(
        TCPAddress("127.0.0.1", int(sys.argv[1])),
        logging.getLogger("e2e.hid"),
        exchange_metadata=False,
    ) as client:
        await client.hid(events())


asyncio.run(main())
