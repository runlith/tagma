---
id: 01a14a4c-dc8a-783f-b297-1f5de80db68d
title: A windowed feed receives the next part without waiting for the client's ACK for each one, while ACKs are on time
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/socket/live.ts
---
The Effect 4.0.1 RPC server sends the next part of a stream only after the client's ACK for the previous one, so a remote client receives no more than one part per RTT: a network broadcast with a 150 ms RTT produced about 6 frames per second. A feed that declared `window` receives from the socket an ACK on the client's behalf right after a part is sent, while fewer than `window` unacknowledged parts are in flight and the oldest of them is no older than two minimum ACK delays measured on that subscription. Otherwise the socket waits for the client's real ACK and hands the server only the one the server waits for; ACKs for already acknowledged parts are quenched, otherwise they would open the wait for the next part early.

The second condition holds the delay on a channel pressed against bandwidth: when parts pile in buffers, ACKs lag, and the window shrinks to one part in flight, as without a window. The window also bounds memory: no more than `window` parts of one subscription in flight.

A subscription key is the request id in the form the client sent it: Effect accepts both a string and a number, and the server will not recognize an ACK with the id in the other form.
