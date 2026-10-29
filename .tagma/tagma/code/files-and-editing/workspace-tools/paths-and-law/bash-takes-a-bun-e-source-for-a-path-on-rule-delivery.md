---
id: 01a14db5-46c4-7a21-9bcc-2f711f1fb98a
title: bash takes a bun -e source for a path on rule delivery
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "The command successfully checked 262144 bytes and printed the measurement JSON, then bash reported a rule-delivery error: FileSystem.stat tried to open /opt/workspaces/runlith/const state=… with the whole -e source in the name. The command itself was not refused.",
    "command": "exec bun -e 'const state=\"~/.tagma-dev/scratch/01a14c17-b1ed-7b23-864a-44198f63889a/io-audit-state\"; const bundle=\"/var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/execution-host-audit-01a14c17/bundle\"; const host=Bun.spawn([`${bundle}/native/execution-holder`,state,`${bundle}/bun`,`${bundle}/host/host.js`,`${state}/boot.json`],{stdin:\"pipe\",stdout:\"pipe\",stderr:\"pipe\"}); let output=\"\"; const drain=async stream=>{for await(const bytes of stream)output=(output+Buffer.from(bytes).toString()).slice(-16384)}; const draining=Promise.all([drain(host.stdout),drain(host.stderr)]); try {while(!output.includes(`${state}/host.sock`)){if(host.exitCode!==null)throw new Error(`host exited ${host.exitCode}: ${output}`);await Bun.sleep(25);} const metric=Bun.spawn([process.execPath,\"packages/execution-host/src/io.bench.ts\",`--bundle=${bundle}`,`--state=${state}`,\"--metric=pipe-stdin\",\"--bytes=262144\",\"--repetitions=1\"],{stdin:\"ignore\",stdout:\"pipe\",stderr:\"pipe\"}); const [stdout,stderr,code]=await Promise.all([new Response(metric.stdout).text(),new Response(metric.stderr).text(),metric.exited]);if(code!==0)throw new Error(`metric exited ${code}: ${stderr}`);const report=JSON.parse(stdout);console.log(JSON.stringify({build:report.build,measured:report.measured}));} finally {host.stdin.end();const code=await host.exited;await draining;if(code!==0)throw new Error(`host exited ${code}: ${output}`);}'",
    "expected": "Run the final benchmark and recognize the bun -e argument as source, not a file path."
  }
---
Filed from project `runlith`.
