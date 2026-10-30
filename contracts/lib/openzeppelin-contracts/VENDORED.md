# Vendored OpenZeppelin Contracts

Source: `@openzeppelin/contracts` version **5.4.0** (npm tarball).
Tarball SHA256:

```
4e4d51f18935b32f0c877bf666ac37f5e5a98e75f03e7a77eb7569f84701f680
```

Only the files required by `QiePredictionMarket.sol` are vendored. They are copied
byte-for-byte from the tarball (directory root `package/` maps to `contracts/`).

| File | SHA256 |
| --- | --- |
| `contracts/utils/Panic.sol` | `270fc8401c1a13fae6a7a4a2dd6e381b95d658896701e51f0d3e2688acab3dec` |
| `contracts/utils/ReentrancyGuard.sol` | `32fbb1c908ec1b4de85cc1bb10091aebd5816ffe80dfdd5ca5e084fbea67a462` |
| `contracts/utils/math/Math.sol` | `92fee281fd46a1b058b190cf21d6b1a528f0433a907850ae1c9bcf36c5c0cd98` |
| `contracts/utils/math/SafeCast.sol` | `9769274bf53f26a7c7896c526ea1980dc9bea5bf5c2a5fd04870008c4afc1de9` |

`LICENSE` is the upstream MIT license (Copyright (c) 2016-2025 Zeppelin Group Ltd),
fetched from tag `v5.4.0`.

Why only these files:

- `Math.mulDiv` is the payout arithmetic (full-precision floor multiply/divide).
- `Panic.sol` and `SafeCast.sol` are compile-time dependencies of `Math.sol`.
- `ReentrancyGuard.sol` is the storage-based guard (not transient storage), which is
  required because the deployment target is `evm_version = paris`.

Do not upgrade or patch these files in place. Replace the whole vendored subset and
update the hashes above when changing versions.
