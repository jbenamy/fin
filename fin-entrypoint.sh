#!/bin/sh
# Resolve 1Password secret references, then start the server. Every environment variable whose value is an op://
# reference (e.g. PLAID_SECRET=op://my-server/fin/PLAID_SECRET in .env) is replaced by the secret it names, read with
# the read-only service-account token mounted at /run/secrets/op_token. With no references this just runs the command.
set -eu
token_file=/run/secrets/op_token

fail() {
  echo "fin: $1" >&2
  sleep 60 # a restart loop would otherwise spend 1Password's hourly/daily request quota
  exit 1
}

refs=$(env | sed -n 's|^\([A-Za-z_][A-Za-z0-9_]*\)=op://.*|\1|p')
if [ -n "$refs" ]; then
  [ -s "$token_file" ] || fail "op:// references in the environment but no 1Password token at $token_file"
  OP_SERVICE_ACCOUNT_TOKEN=$(cat "$token_file")
  export OP_SERVICE_ACCOUNT_TOKEN
  for name in $refs; do
    eval "ref=\$$name"
    value=$(op read "$ref") || fail "could not read $name ($ref) from 1Password"
    export "$name=$value"
  done
  unset OP_SERVICE_ACCOUNT_TOKEN
fi
exec "$@"
