# Deploying EnvironetBE

> **Heads up:** the primary way to run the backend is now the
> [Environet-DockerCompose](https://github.com/penguin5681/Environet-DockerCompose)
> repository — public images on Docker Hub, no login, no insecure-registry
> config, one command. Everything below is the **legacy/self-hosted fallback**
> kept for the private LAN registry path.

## Legacy path: private registry on the backend machine (LAN/Tailscale)

A self-hosted Docker registry runs on the backend machine at
`192.168.0.100:5000` (Tailscale: `100.84.20.121:5000`). It serves the same
images over plain HTTP with basic auth, so clients must whitelist it first:

- **Docker Desktop:** Settings → Docker Engine → add
  `"insecure-registries": ["192.168.0.100:5000", "100.84.20.121:5000"]` →
  Apply & Restart.
- **Linux:** `/etc/docker/daemon.json` with the same JSON → `sudo systemctl restart docker`.

Then:

```bash
docker login <registry-host>:5000 -u frontend   # password from the backend team
docker compose -f deploy/docker-compose.yml up -d
```

**Address consistency rule:** the address in `insecure-registries`, the
`docker login` host, and the image refs in `deploy/docker-compose.yml` must all
be the exact same `IP:5000` string.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Get "https://…/v2/": connection refused` (port 443) | The registry address was used **without `:5000`**, so Docker tried HTTPS on 443. Always write `IP:5000`. |
| `server gave HTTP response to HTTPS client` | The insecure-registries entry is missing, invalid, or Docker wasn't restarted. |
| `unauthorized: authentication required` | `docker login` again; check the password with the backend team. |
| `failed to bind host port 3000/5432 … address already in use` | Another process owns the port — stop it or change the **left** port in the `ports:` mapping. |
| Pull hangs / connection refused on 5000 | The backend machine must be powered on and reachable (same LAN for `192.168.0.100`, Tailscale running on both machines for `100.84.20.121`). |

## Recommended instead

```bash
git clone https://github.com/penguin5681/Environet-DockerCompose
cd Environet-DockerCompose
docker compose up -d --wait
```

See that repo's README for the full guide.
