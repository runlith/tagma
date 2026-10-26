export function surfacePlaceholderPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tagma</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        font: 15px/1.6 ui-sans-serif, system-ui, sans-serif;
      }
      main { max-width: 34rem; padding: 2rem; }
      h1 { font-size: 1rem; font-weight: 600; margin: 0 0 .75rem; letter-spacing: .02em; }
      p { margin: 0 0 .75rem; opacity: .8; }
      code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .9em; }
      button { font: inherit; padding: .35rem .9rem; border-radius: .4rem; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>Tagma</h1>
      <p id="said">Reading what this server is doing.</p>
      <p id="where"></p>
      <button id="again" type="button">Reload</button>
    </main>
    <script>
      const said = document.getElementById('said');
      const where = document.getElementById('where');
      async function read() {
        let surface;
        try {
          surface = (await (await fetch('/health', { cache: 'no-store' })).json()).builds.surface;
        } catch {
          said.textContent = 'This server stopped answering.';
          where.textContent = '';
          return;
        }
        if (surface.served) return location.reload();
        said.textContent = 'Nothing is installed on this machine, and nothing is built while a server runs.';
        where.textContent = 'Once an installation stands, this server hands out its surface.';
      }
      document.getElementById('again').addEventListener('click', read);
      addEventListener('focus', read);
      addEventListener('visibilitychange', () => { if (!document.hidden) read(); });
      read();
    </script>
  </body>
</html>
`;
}
