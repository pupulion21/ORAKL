# Perbaikan hasil review OpenCode

Target: QIE EVM Testnet (chain 1983). Pekerjaan ini memperbaiki kode lokal dan menguji alur aplikasi dengan provider/RPC tiruan. Tidak ada signing, broadcast, atau deployment ke jaringan QIE dalam pengerjaan ini.

## Perbaikan

- Timestamp `uint64` di luar rentang JavaScript Date ditampilkan sebagai `—`, sehingga satu market tidak menjatuhkan render daftar. Input tanggal di luar rentang juga ditangani.
- Pergantian akun langsung mengosongkan sesi akun selama pemeriksaan chain. Pergantian chain, disconnect, dan dispose membatalkan persiapan transaksi yang masih menunggu chain ID. Akun pengirim harus tetap sama dengan akun saat review.
- Modal konfirmasi selesai setelah wallet memberikan hash. Receipt yang terlambat dipantau dan dipulihkan berdasarkan hash tersebut, tanpa mengirim transaksi baru dari modal yang sama.
- Hasil receipt dan pemulihan aplikasi dipisahkan. Jika verifikasi deployment gagal sementara, tombol pemulihan bisa mengulangi pembacaan/verifikasi. Callback yang sudah selesai tidak dijalankan dua kali; callback gagal masih bisa dicoba lagi.
- Transaksi pending, unknown, atau belum selesai dipulihkan tidak dibuang oleh tombol hapus/bersihkan atau batas enam catatan.
- Runtime code, saldo kontrak, dan semua komponen accounting dibaca pada nomor blok yang sama. Kegagalan pembacaan blok tersebut dilaporkan, tanpa mengganti dengan pembacaan latest yang tidak konsisten.
- Navigasi setelah createMarket memperbarui halaman melalui handler hashchange. ID market dibaca dari event MarketCreated milik kontrak tujuan; fallback marketCount - 1 yang ambigu dihapus.
- Mock penolakan wallet diperbaiki agar tes penolakan write menolak eth_sendTransaction, bukan pemeriksaan eth_chainId sebelumnya.

## Validasi

| Pemeriksaan | Hasil |
| --- | --- |
| `cd frontend && npm test` | PASS, seluruh empat file tes |
| `cd frontend && node --test --test-isolation=none --test-reporter=spec test/*.test.ts` | PASS, 34/34 tes |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run build` | PASS |
| `cd contracts && forge test --offline` | PASS, 61/61 tes; mencakup fuzz dan lima invariant dalam suite invariant |
| Perbandingan ABI, hash source, creation bytecode, runtime bytecode terhadap artifact build | Semua cocok |
| Chromium dengan EIP-1193 wallet dan RPC tiruan | PASS, empat skenario; tidak ada page error |

Laporan browser: [browser-regression.json](browser-regression.json). Skenario browser meliputi render timestamp ekstrem dan pemulihan receipt create, stake, serta deploy. Fixture memperpendek timeout receipt ke 100 ms untuk menguji jalur timeout; timeout aplikasi tetap 180 detik. Jumlah permintaan wallet dalam fixture adalah tiga, masing-masing satu untuk create, stake, dan deploy.

## Panduan QIE yang digunakan

Skill yang digunakan: `qie` (router, D12), `qie-frontend` (D07), `qie-wallets` (D03), dan `qie-transactions` (D06), dari instalasi lokal `/home/pupulion/archademy-startups/.agents/skills/`.

Keempat bundle memiliki release ID yang sama: `3f88cb8b595dfdc2b3defa38ffb1d0e6efc71ee9d3158210d41262620561e30b`, release `0.5.2-ecosystem.1`. Panduan dipakai untuk invalidasi sesi, pemisahan receipt dan efek aplikasi, pengikatan identitas transaksi, serta pemulihan lewat pembacaan tanpa resubmission. Toolchain kontrak proyek tetap sesuai konfigurasi yang sudah ada.

Tes ini tidak membuktikan kompatibilitas extension QIE Wallet sungguhan, dukungan endpoint live atas pembacaan blok tertentu, atau finality jaringan. Live preflight dan transaksi QIE sungguhan belum dijalankan. Receipt sukses menyatakan execution pada blok yang diamati, bukan jaminan finality.
