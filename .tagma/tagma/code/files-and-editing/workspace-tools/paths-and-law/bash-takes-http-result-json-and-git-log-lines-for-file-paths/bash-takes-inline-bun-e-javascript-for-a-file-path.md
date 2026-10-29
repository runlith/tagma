---
id: 01a12c90-62f4-732b-9a19-663aa6377375
title: bash takes inline bun -e JavaScript for a file path
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Exit 0 and the smoke passed, but metadata added Unknown: FileSystem.stat (/opt/workspaces/runlith/const { main } = {}; ...), treating the whole bun -e JavaScript argument as a path. The false diagnostic added about 1.4 KB of output. Execution 573b51a0-055e-4650-9f37-86e7e23be400:163.",
    "command": "bash(command=\"env -u TAGMA_SERVER_URL -u TAGMA_CALLER -u TAGMA_HARNESS_SESSION -u TAGMA_TERMINAL -u TAGMA_SESSION_ACT -u TAGMA_SESSION_GRANT TAGMA_DATABASE_PATH=/var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/tagma-exec-host-01a12c86/data/tagma.sqlite TAGMA_INSTALL_ROOT=/var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/tagma-exec-host-01a12c86/install TAGMA_PORT=17423 bun -e 'const { main } = {}; const env=process.env; const op=async(id,input)=>{const child=Bun.spawn([\\\"bun\\\",\\\"apps/tagma/server/src/composition/entries/cli.ts\\\",\\\"op\\\",id,\\\"--json\\\",JSON.stringify(input)],{env,stdout:\\\"pipe\\\",stderr:\\\"pipe\\\"}); const [text,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]); if(code!==0)throw new Error(text+err); return JSON.parse(text)}; const execution=\\\"9cf7b220-0af4-4117-ad94-ba8c7ae9d4d3\\\",incarnation=0; const state=await op(\\\"read_terminal\\\",{execution,incarnation}); const stdout=await op(\\\"read_terminal_bytes\\\",{execution,incarnation,stream:\\\"stdout\\\",offset:\\\"0\\\",limit:100}); const stderr=await op(\\\"read_terminal_bytes\\\",{execution,incarnation,stream:\\\"stderr\\\",offset:\\\"0\\\",limit:100}); const out=Buffer.from(stdout.bytes,\\\"base64\\\").toString(); const err=Buffer.from(stderr.bytes,\\\"base64\\\").toString(); if(state.state.nativeExit.code!==7||out!==\\\"stdout-proof\\\"||err!==\\\"stderr-proof\\\"||stdout.range.gap||stderr.range.gap)throw new Error(JSON.stringify({state,out,err})); console.log(JSON.stringify({phase:state.state.phase,exit:state.state.nativeExit,stdout:out,stderr:err,gap:false}));'\",waitMs=1000,lifeMs=60000)",
    "expected": "A successful smoke check returns stdout JSON; the -e argument's inline code addresses no checkout file."
  }
---
Filed from project `runlith`.
