# Secrets

Sulion's secret handling is split away from the PTY runtime.

## Shape

- `frontend` calls the secret broker directly through `/broker/*` with the user's Cognito JWT.
- `backend` does **not** unlock secrets and does not hold the broker master key.
- `broker` stores encrypted secret payloads in the separate `sulion_broker` database and decrypts them with a master key mounted only into the broker container.

## Runtime use

Two tool paths are wired in the PTY image:

- `aws ...`
  - wrapper at `/opt/sulion/bin/aws`
  - uses secret id `aws-default` unless `SULION_AWS_SECRET_ID` overrides it
- `with-cred [secret-id] -- <command...>`
  - wrapper at `/opt/sulion/bin/with-cred`

Both wrappers require `SULION_PTY_ID` and call the broker directly at `SULION_SECRET_BROKER_URL`.
The PTY image also needs `SULION_SECRET_BROKER_USE_TOKEN`; the wrappers send it as a bearer token when redeeming grants.

The broker grants secrets per `(pty_session_id, secret_id, tool)` with expiry, but the only supported `tool` values are `with-cred` and `aws`. `with-cred` always redeems against the `with-cred` grant bucket, regardless of the target command name. If `with-cred` is passed a `secret-id`, it injects that one secret bundle. If it is called without a `secret-id`, it injects every currently unlocked secret bundle for that PTY under `with-cred`. If multiple unlocked bundles define the same env var name, the broker rejects the request instead of silently overriding one value with another.

## Broker endpoints

Authenticated browser endpoints:

- `GET /broker/v1/secrets`
- `PUT /broker/v1/secrets/:id`
- `DELETE /broker/v1/secrets/:id`
- `GET /broker/v1/grants?pty_session_id=<uuid>`
- `POST /broker/v1/grants`
- `DELETE /broker/v1/grants`

Authenticated PTY-use endpoint:

- `POST /broker/v1/use`

`/broker/v1/use` is limited to redeeming already-active grants; it cannot create or extend unlock state.
