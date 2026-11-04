import asyncio
import json
import logging
import math
import sys

from idb.common.types import HIDDelay, HIDDirection, HIDPress, HIDTouch, Point, TCPAddress
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
    while True:
        pending = asyncio.ensure_future(reader.readline())
        while not pending.done():
            await asyncio.wait({pending}, timeout=INTERVAL)
            if not pending.done() and last is not None:
                yield sample(*last)
        line = pending.result()
        if not line:
            break
        command = json.loads(line)
        phase = command["phase"]
        if phase == "swipe":
            start, end = command["from"], command["to"]
            origin, target = (start["x"], start["y"]), (end["x"], end["y"])
            resolution = math.ceil(math.dist(origin, target) / command["delta"])
            cadence = math.floor(command["duration"] / INTERVAL)
            steps = max(2, min(resolution, cadence))
            interval = command["duration"] / steps
            yield sample(*origin)
            for index in range(1, steps + 1):
                yield HIDDelay(duration=interval)
                fraction = index / steps
                yield sample(
                    origin[0] + (target[0] - origin[0]) * fraction,
                    origin[1] + (target[1] - origin[1]) * fraction,
                )
            yield HIDDelay(duration=interval)
            yield sample(*target, HIDDirection.UP)
            print(json.dumps({"id": command["id"]}), flush=True)
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
