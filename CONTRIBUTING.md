# Contributing to the Hermes Labs plugin catalog

This repository distributes reviewed plugins whose implementations live in
Hermes Labs product repositories. It does not accept copied product code.

## Propose an entry

Before changing the catalog, the product repository must contain an
installable plugin root with a manifest and a primary-task acceptance test.
Public installs must not depend on a developer checkout or an organization SSH
key.

Update only `catalog.json` by hand. Each entry must name:

- the stable plugin identifier;
- the public product repository and plugin-root path;
- the released version and full 40-character reviewed commit;
- the actual capability types;
- the exact target hosts and an honest compatibility status for each host.

Then run:

```bash
npm run generate
npm test
npm run verify
npm run verify:network
```

Commit the input and generated manifests together. Pull requests that edit a
generated manifest without the corresponding catalog change will fail.

## Compatibility claims

Use `verified` only after a clean installation and end-to-end primary-task
test on that host. Use `listed-unverified` to preserve an existing route whose
runtime has not yet been certified. Use `unsupported` when a host cannot load
or enforce the capability.

Report skills, MCP connections, and hooks separately. In particular, do not
describe inbound prompt screening as outbound tool-execution blocking.

## Issues

Catalog, install-route, and manifest-generation problems belong in this
repository. Product behavior problems belong in the linked product
repository.
