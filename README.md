# htchess — cờ vua 3D

Demo web cờ vua 3D: Blazor WebAssembly + Three.js, chơi 2 người hoặc đấu máy.

**Chơi ngay:** https://hoangthb96.github.io/htchess/

## Screenshot

![htchess — bàn cờ 3D](docs/screenshot.png)

## Disclaimer

> **Dự án này được dựng bằng _vibecoding_**: toàn bộ code do AI agent
> ([Devin](https://devin.ai)) viết, người dùng chỉ đưa yêu cầu, điều hướng
> và nghiệm thu. Đây là demo cho vui/mục đích học tập — không phải sản phẩm
> production; dùng tự chịu rủi ro, không có bảo đảm.

## Tính năng

- Bàn cờ 3D Three.js: bàn gỗ walnut, bụi trong ánh đèn, quân bị bắt ngã nằm
  trên bàn như cờ thật, camera parallax theo con trỏ, tự zoom khi có quân ăn
- Click/drag kéo thả, premove, đồng hồ + increment, đầy đủ luật (nhập thành,
  en passant, phong cấp, chiếu hết, mọi thể loại hòa)
- Đấu máy (negamax + alpha-beta, 3 độ sâu) cầm Trắng hoặc Đen
- Movelist SAN tự cuộn theo nước đi, điều hướng xem lại, dàn FEN, copy PGN,
  eval bar, âm thanh
- Vẽ mũi tên chú thích trên bàn bằng chuột phải kéo (right-drag)
- Toggle âm thanh, cảnh báo sắp hết giờ (low-time warning)
- Lưu ván tự động + chơi tiếp (persistence/resume), chia sẻ ván qua link FEN
- Panel điều khiển dạng overlay (hover/toggle, thành bottom-sheet trên mobile)

## Cấu trúc

- `htchess` — host ASP.NET Core (Blazor Web App, render mode InteractiveWebAssembly)
- `htchess.Client` — WASM runtime cho host trên
- `htchess.Shared` — toàn bộ game: `Pages/Chess.razor`, luật ván (`Chess/`),
  assets tĩnh (`wwwroot/js`, `wwwroot/lib/three`, `app.css`)
- `htchess.GhPages` — Blazor WASM standalone host `htchess.Shared`,
  publish ra static files cho GitHub Pages
- `htchess.Tests` — xunit cho `GameSession`/`SimpleAi`

## Chạy local

```bat
serve.bat            :: publish + host http://<ip>:5272/chess (cần .NET 11 SDK)
```

hoặc bản static (như trên GH Pages):

```powershell
dotnet publish htchess.GhPages -c Release -o gh-out
# serve gh-out/wwwroot tại path /htchess/
```

## Deploy

Site static phục vụ từ branch `gh-pages` (source: root `/`). Cập nhật:

```powershell
dotnet publish htchess.GhPages -c Release -o gh-out
git worktree add ../htchess-ghp gh-pages
robocopy gh-out\wwwroot ..\htchess-ghp /MIR
cd ..\htchess-ghp && git add -A && git commit -m "Deploy" && git push origin gh-pages
```

## Stack

.NET 11 RC · Blazor WebAssembly · Three.js (vendored) ·
[Rudzoft.ChessLib](https://www.nuget.org/packages/Rudzoft.ChessLib)

## Ghi chú dev (handoff)

**Theme quân cờ** (`Tuỳ chỉnh → Quân cờ`): `classic` (Staunton gỗ),
`modern` (hình học), `metal` (Staunton + env phản chiếu). Persist qua
`localStorage["htchess.pieceTheme"]`. Toàn bộ trong
`htchess.Shared/wwwroot/js/chess3d.js`:

- `PIECE_THEMES` map tên → builder (`buildStaunton`/`buildModern`) + material
- `buildPiece()` thêm đế nỉ (felt ring) + `userData.{type,isWhite,theme}`
- `setPieceTheme(name)` rebuild tại chỗ cả quân đứng lẫn quân bị bắt,
  `disposePiece()` dọn geometry cũ
- Mã: `knightHeadGeo()` extrude silhouette + taper z về mõm + `maneGeo()`
  sống bờm + nghiêng đầu; vật liệu classic dùng `MeshPhysicalMaterial`
  clearcoat + `woodBump()` vân gỗ procedural
- Tọa độ trong góc ô kiểu lichess (`rebuildCoords`), không còn nhãn viền khung
- Debug bridge `globalThis.chess3d`: `_screenPos(sq)`, `_pick(x,y)`, `_debug()`,
  `_setupFen(fen)`, `setPieceTheme/getPieceTheme`, `flipBoard` — đủ để test
  E2E bằng Playwright không cần UI

**Deploy/lệnh:**

- SDK đúng: `%USERPROFILE%\.dotnet\dotnet.exe` (11.0.100-rc.3) — `dotnet`
  trong PATH là SDK 10, sẽ fail NETSDK1045
- Publish PHẢI có build đầy đủ: `--no-build` không nén lại `.br/.gz` → server
  trả asset nén cũ (lỗi "module cũ" dù file raw mới)
- `serve.bat` bắt buộc `cd publish\` trước khi chạy exe — sai CWD → ContentRoot
  sai → static assets trả 200 nhưng 0 byte
- `gh-pages`: `dotnet publish htchess.GhPages -c Release -o gh-out`, copy
  `gh-out/wwwroot/*` vào worktree branch `gh-pages`, push
- Test: `"$USERPROFILE/.dotnet/dotnet" test htchess.Tests` (xunit, chạy vài giây)
- Token `gh` hiện thiếu scope `workflow` → `.github/workflows/pages.yml` chỉ
  nằm local (untracked), auto-deploy CI chưa bật — deploy thủ công bằng lệnh
  trên; muốn CI thì `gh auth refresh -s workflow`, push file workflow rồi đặt
  Pages source = GitHub Actions
- Test static local: `python -m http.server 8899` trong `gh-serve/` (serve
  `/htchess/`), hoặc server thật `http://localhost:5272/chess` /
  Tailscale `http://100.125.47.99:5272/chess`
- `gh-serve/` và `gh-out/` là artifact, đã gitignore
