# Security

## Reporting a vulnerability

Report a vulnerability privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (<https://github.com/runlith/tagma/security/advisories/new>). Do not open a public issue for it.

Include what is affected, how to reproduce it and what an attacker gains. You will get an answer once the report is read; a confirmed issue is fixed in this repository and credited in its advisory unless you ask otherwise.

## Scope

Tagma runs on your machine: its server, the agents it starts and the commands they run act with your user's permissions on the projects you register. A report is in scope when Tagma lets someone do more than that — reach the server or its credentials from another machine or another local user, run commands the operator did not allow, or read secrets it stores — or when it exposes data outside the machine without the operator's choice.

Only the latest commit of `main` is supported.
