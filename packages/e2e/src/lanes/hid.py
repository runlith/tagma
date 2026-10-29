import asyncio
import json
import logging
import math
import sys

from idb.common.types import HIDDirection, HIDPress, HIDTouch, Point, TCPAddress
from idb.grpc.client import Client

STEP = 5.0
INTERVAL = 1 / 120


def sample(x, y, direction=HIDDirection.DOWN):
    return HIDPress(action=HIDTouch(point=Point(x=x, y=y)), direction=direction)


async def events():
    reader = asyncio.StreamReader()
    await asyncio.get_running_loop().connect_read_pipe(
        lambda: asyncio.StreamReaderProtocol(reader), sys.stdin
    )
    last = None
    while line := await reader.readline():
        command = json.loads(line)
        phase = command["phase"]
        x, y = command["x"], command["y"]
        if phase == "press":
            yield sample(x, y)
        elif phase == "move":
            steps = max(1, math.ceil(math.dist(last, (x, y)) / STEP))
            for index in range(1, steps + 1):
                await asyncio.sleep(INTERVAL)
                yield sample(last[0] + (x - last[0]) * index / steps, last[1] + (y - last[1]) * index / steps)
        elif phase == "release":
            yield sample(x, y, HIDDirection.UP)
        else:
            raise ValueError("unknown touch phase: " + phase)
        last = (x, y)
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
