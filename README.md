# pumex-merged-envio

An [Envio HyperIndex](https://docs.envio.dev) indexer covering five Pumex
subsystems in a single process, database and GraphQL endpoint:

| subtree | what it indexes | chains |
|---|---|---|
| `farm` | Algebra eternal farming | 239 |
| `analytics` | Algebra Integral pools, positions and volume | 239, 9745 |
| `helper` | gauges, ve locks, options, pre-mining | 59144, 9745, 1776, 4663 (+ 48900) |
| `v1` | UniV2-style pairs, factory and day data | 239, 59144, 9745, 1776, 4663 (+ 48900) |
| `v4` | Uniswap v4 PoolManager and PositionManager | 1776, 4663 (+ 1439) |

Entity types are prefixed per subtree — `Farm_`, `Analytics_`, `Helper_`, `V1_`,
`V4_` — so all five coexist in one database and each stays queryable on its own.

## Chains

| chain | id | state |
|---|---|---|
| TAC | 239 | active |
| Linea | 59144 | active |
| Plasma | 9745 | active |
| Injective | 1776 | active |
| Robinhood | 4663 | active |
| Injective testnet | 1439 | skipped — see [Chain notes](#chain-notes) |
| Zircuit | 48900 | skipped — see [Chain notes](#chain-notes) |

## Prerequisites

- Node.js 22+
- pnpm
- Docker (for `envio dev`, which runs Postgres and Hasura locally)

## Environment variables

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored.

| variable | required | what for |
|---|---|---|
| `ENVIO_API_TOKEN` | yes | HyperSync access — create one at https://envio.dev/app/api-tokens |
| `ENVIO_RPC_URL_239` | yes | TAC |
| `ENVIO_RPC_URL_59144` | yes | Linea |
| `ENVIO_RPC_URL_9745` | yes | Plasma |
| `ENVIO_RPC_URL_1776` | yes | Injective |
| `ENVIO_RPC_URL_4663` | yes | Robinhood |
| `ENVIO_RPC_URL_48900` | only if 48900 is enabled | Zircuit |
| `ENVIO_RPC_URL_1439` | only if 1439 is enabled | Injective testnet |

The naming is uniform: `ENVIO_RPC_URL_<chainId>`, read by every subtree.

These should be archive endpoints. Contract reads are pinned to the block of the
event that triggered them, so a pruned node answers from a later state rather
than failing. Where a variable is unset the indexer falls back to a public
endpoint and logs a warning.

## Running locally

```bash
pnpm install
pnpm envio codegen        # required after any config.yaml or schema.graphql edit
pnpm envio dev            # needs Docker
```

`envio dev` starts Postgres and Hasura in containers and serves GraphQL from the
Hasura console (http://localhost:8080 by default). `pnpm envio dev -r` restarts
from scratch, dropping the existing data.

```bash
pnpm typecheck            # tsc --noEmit
pnpm test                 # unit tests over the pure helpers, no network or database
```

## Chain notes

**TAC (239)** — syncs from HyperSync. One block range is not currently
retrievable, and it cannot be backfilled from RPC either: TAC's own RPC returns
a transaction-encoding error (`MsgEthereumTx`) for those blocks on every
endpoint we tested. That error comes from the chain's node software rather than
from anything in this indexer.

We have kept this chain on HyperSync for the same reason — over RPC, TAC does
not reliably return transaction fields beyond `hash`, and `Transaction.id`,
`Mint.origin` and `Farm_Deposit.owner` are built from them. A task is open with
the TAC team, and once the encoding issue is fixed upstream both the missing
range and the RPC option should resolve on their own.

**Zircuit (48900)** — skipped only because we did not have an RPC endpoint with
complete log history for it; the public endpoints we tested retain just the
recent blocks. Nothing else is missing — the chain is fully wired. Point
`ENVIO_RPC_URL_48900` at an endpoint that serves full historical logs and delete
`skip: true` from the chain's block in `config.yaml`, and it should run.

**Injective testnet (1439)** — skipped only because we did not have an RPC
endpoint for it. Nothing else is missing: the chain is fully wired. Set
`ENVIO_RPC_URL_1439` to your own endpoint and delete `skip: true` from the
chain's block in `config.yaml`, and it should run. This chain syncs over RPC
rather than HyperSync, so that endpoint serves both the sync and the contract
reads and needs to be an archive node.
