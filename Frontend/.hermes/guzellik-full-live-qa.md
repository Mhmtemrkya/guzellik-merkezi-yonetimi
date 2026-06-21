# Güzellik Merkezi — Full Live QA Ledger

Owner: KAYA
Mode: live `browser-use` via Cloudflare tunnel + cloud browser.
Frontend WSL cwd: `/home/kaya/projects/guzellik-frontend`
Frontend Windows cwd: `C:\Users\KAYA\Desktop\Güzellik Merkezi Yönetimi\Frontend`
Backend cwd: `/home/kaya/projects/guzellik-backend`
Visible app tunnel during this run: `https://updates-motherboard-ours-easy.trycloudflare.com`

## Rule

All panels, pages, and visible features must be exercised end-to-end in live browser-use. Found errors must be fixed and retested before final completion.

## Seed credentials

- Kurum Yöneticisi: `admin@armonessa.test` / `Guzellik123!`
- Personel: `personel@armonessa.test` / `Guzellik123!`
- Platform Admin: `platform@armonessa.test` / `Guzellik123!`

## Panels and routes to test

### Public / Auth
- [ ] `/` landing: nav anchors, Demo/Giriş links, scroll sections, CTA links, console/resource errors.
- [ ] `/login`: role selection, invalid validation, admin login, personel login, platform login, institution/branch scope loading.

### Platform Admin
- [ ] `/platform` overview.
- [ ] `/platform/kurumlar`: tenant list/search/create/edit/delete QA-created tenant only, success state after reload.
- [ ] `/platform/uyarilar`: health warning state/actions/placeholders.
- [ ] `/platform/finans`: MRR/subscription state/actions/placeholders.
- [ ] `/platform/fatura`: billing state/actions/placeholders.
- [ ] `/platform/sistem`: system settings state/actions/placeholders.
- [ ] sidebar/logout/guard behavior.

### Kurum Yöneticisi / Admin
- [x] `/admin/musteriler`: edit modal PUT success persists after list reload.
- [x] `/admin/personel`: edit modal PUT success persists after list reload.
- [x] `/admin/paketler`: service edit modal PUT success persists after list reload.
- [ ] `/admin`: dashboard cards, branch switcher, appointment list, quick links.
- [ ] `/admin/onaylar`: backend-pending/empty state and visible actions.
- [ ] `/admin/loglar`: backend-pending/empty state and visible actions.
- [ ] `/admin/musteriler`: create, search, select, edit, delete QA-created customer only, Excel buttons if implemented.
- [ ] `/admin/paketler`: create, select/unselect package preview, edit, delete QA-created service only.
- [ ] `/admin/stok`: backend-pending/PDF state.
- [ ] `/admin/randevular`: create/edit/status/filter/date behavior if exposed.
- [ ] `/admin/kasa`: backend-pending state.
- [ ] `/admin/on-muhasebe`: backend-pending/PDF state.
- [ ] `/admin/raporlar`: backend-pending/report state.
- [ ] `/admin/bildirimler`: state/actions.
- [ ] `/admin/ayarlar`: settings state/actions.
- [ ] sidebar/logout/route guard.

### Personel
- [ ] `/personel`: dashboard.
- [ ] `/personel/randevular`: list/filter/status actions if exposed.
- [ ] `/personel/musteriler`: list/search/select details.
- [ ] `/personel/seanslar`: backend-pending state.
- [ ] `/personel/paketler`: backend-pending/package state.
- [ ] `/personel/stok`: backend-pending/stock state.
- [ ] `/personel/kasa`: backend-pending/cash state.
- [ ] `/personel/raporlar`: performance/report state.
- [ ] `/personel/loglar`: history state.
- [ ] `/personel/bildirimler`: notifications state.
- [ ] `/personel/profil`: profile state/actions.
- [ ] sidebar/logout/route guard.

## Issues found

None open yet in this ledger. Add each with: page, feature, steps, expected, actual, fix file, retest result.

## Current live state

Last known page: `/admin/paketler`, service edit modal success visible.
Next planned area: Platform Admin full panel QA, then remaining Admin pages, then Personel and public/auth.
