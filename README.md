# htchess — cờ vua 3D

Demo web cờ vua 3D: Blazor WebAssembly + Three.js, chơi 2 người hoặc đấu máy.

**Chơi ngay:** https://hoangthb96.github.io/htchess/

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
- Movelist SAN, điều hướng xem lại, dàn FEN, copy PGN, eval bar, âm thanh
- Panel điều khiển dạng overlay (hover/toggle, thành bottom-sheet trên mobile)

## Cấu trúc

- `htchess` — host ASP.NET Core (Blazor Web App, render mode InteractiveWebAssembly)
- `htchess.Client` — WASM runtime cho host trên
- `htchess.Shared` — toàn bộ game: `Pages/Chess.razor`, luật ván (`Chess/`),
  assets tĩnh (`wwwroot/js`, `wwwroot/lib/three`, `app.css`)
- `htchess.GhPages` — Blazor WASM standalone host `htchess.Shared`,
  publish ra static files cho GitHub Pages

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
