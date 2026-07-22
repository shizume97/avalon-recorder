# Avalon Recorder Google Sheet Setup

## Sheet format requirement

- The settings worksheet must be named `settings`.
- Apps Script reads and writes settings data from the `settings` worksheet only.
- The previous "first worksheet is settings" fallback is no longer supported.
- New record worksheets are written with a `sessionRecord` marker. Existing `dailyRecord`
  worksheets are still readable by the web app for compatibility.
- Apps Script writes record and index cells as plain text, including numeric-looking values
  such as `round`, `gid`, `TRUE`, `FALSE`, and `failCount`, to reduce Google Visualization
  CSV type-inference issues.

這個資料夾存放初始化 Avalon Recorder 用 Google Sheet 所需的檔案：

- `main.js`：貼到 Google Apps Script 的 Web App 程式碼。
- `appsscript.json`：Apps Script manifest 參考設定。
- `README.md`：建立 Sheet、初始化模板、部署 Web App 與填寫設定的說明。

## 手動部署

1. 在目標 Google Sheet 內打開 `擴充功能` -> `Apps Script`。
2. 將 `main.js` 內容貼到 Apps Script 編輯器。
3. 儲存後回到 Google Sheet，重新整理頁面，選單會出現 `Avalon Recorder`。
4. 執行 `Avalon Recorder` -> `建立空白模板`，建立或補齊 `settings` 工作頁。
5. 在 `專案設定` -> `指令碼屬性` 新增：
   - `AVALON_WRITE_KEY`
   - value 使用自己產生的一段寫入密鑰
6. 部署為 `網頁應用程式`：
   - 執行身分：我
   - 存取權：所有人
7. 將 Web App `/exec` URL 填回設定頁 `appConfig` 的 `writeEndpoint`。
8. 在設定頁 `players` 區塊填入玩家 id 與名稱。
9. 網頁 URL 使用 `?sheetId={SHEET_ID}#key={AVALON_WRITE_KEY}` 進入可寫模式。

## 空白模板

`setupAvalonRecorderTemplate()` 會建立或補齊下列 `settings` 工作頁格式：

```text
players
id      name

appConfig
key             value
writeEndpoint

recordSheets
date            sheetName       gid
```

- 如果已經有 `settings` 工作頁，函數只會補上缺少的區塊，不會覆蓋既有資料。
- 如果沒有 `settings` 工作頁，且第一個工作頁是空白，函數會把第一個工作頁改名為 `settings`。
- 如果沒有 `settings` 工作頁，但第一個工作頁已有內容，函數會新增一個 `settings` 工作頁。
- 建立者只需要手動填 `players` 與 `appConfig.writeEndpoint`。

## 支援的 action

- `createSessionRecord`
  - 寫入前會先檢查 `recordSheets` 內的 `sheetName` 是否仍存在，並清除不存在的索引列
  - 建立新的紀錄工作頁
  - 將新工作頁前 10 欄預設為純文字格式
  - 在設定頁 `recordSheets` 區塊追加索引
  - 寫入 `sessionRecord`、`date`、`title`、`note`、`schemaVersion`、`updatedAt`

  - 相容舊 action：`createDailyRecord`

- `updateSessionRecord`
  - 寫入前會先檢查 `recordSheets` 內的 `sheetName` 是否仍存在，並清除不存在的索引列
  - 修改既有紀錄工作頁的 `date`、`title`、`note`
  - 更新該紀錄工作頁的 `updatedAt`
  - 同步更新設定頁 `recordSheets` 區塊中該工作頁的日期

  - 相容舊 action：`updateDailyRecord`

- `createGameRecord`
  - 在指定紀錄工作頁底部追加一個 `gameRecord` 區塊
  - 寫入該場次的 `updatedAt`
  - 從前端 payload 產生 `players`、`ladyOfTheLake`、`assassination`、`rounds`
  - 依任務紀錄推導 `winner` / `victoryCondition`
  - 若尚未達成勝利條件，會寫入 `winner: unknown` 與 `victoryCondition: unknown`
  - 若 payload 的 `players[]` 帶有 settings `players` 區塊中不存在的 `playerName`，會先分配新的數字 player id 並追加到 settings `players`
  - 同步更新該紀錄工作頁的 `updatedAt`

- `updateGameRecord`
  - 以同一個 `gameId` 重建既有 `gameRecord` 區塊
  - 更新該場次的 `updatedAt`
  - 用於網頁編輯既有場次後覆蓋寫回
  - 與 `createGameRecord` 相同，會把新玩家名稱補進 settings `players` 後再寫入場次紀錄
  - 同步更新該紀錄工作頁的 `updatedAt`

- `deleteGameRecord`
  - 刪除指定 `gameId` 的整個 `gameRecord` 區塊
  - 同步更新該紀錄工作頁的 `updatedAt`

## updatedAt

- `updatedAt` 使用 ISO 8601 字串，例如 `2026-07-19T06:32:18.000Z`。
- 紀錄工作頁的 `updatedAt` 代表該筆紀錄最後一次被 Apps Script 改動的時間。
- 每個 `gameRecord` 區塊的 `updatedAt` 代表該場次最後一次被建立或覆寫的時間。
- 既有舊工作頁若沒有 `updatedAt`，第一次透過 `updateSessionRecord`、`createGameRecord`、`updateGameRecord` 或 `deleteGameRecord` 寫入時會自動補上。

## recordSheets cleanup

- `createSessionRecord` 與 `updateSessionRecord` 寫入前會檢查 `settings.recordSheets` 中每個 `sheetName` 是否仍存在。
- 不存在的紀錄索引會從 `recordSheets` 表格範圍內清掉，存在的列會往上補齊。
- 清理時只重寫 `recordSheets` 自己的欄位範圍，不會刪除整個 Google Sheet row。

## Plain text writes

- Apps Script 寫入 Sheet 前會先把目標 range 設為純文字格式。
- 寫入值會統一轉成字串，避免 Google Sheet / Google Visualization 將同一欄推斷為數字或布林欄後，把 header 文字視為空值。
- 新建紀錄工作頁時，前 10 欄會預先設為純文字，方便之後手動補資料。
- 既有工作頁不會被整頁重設格式；但每次透過 Apps Script 新增或覆寫的區塊都會以純文字寫入。

## 注意

Apps Script 修改後必須重新部署新版本。只按儲存不會更新既有 `/exec` 部署。

## Game player payload

前端送出的 game payload 中，`players` 每列格式為：

```json
{
  "playerId": "custom-player-6",
  "playerName": "新玩家",
  "role": "unknown"
}
```

- `playerId` 已存在於 settings `players` 時，直接使用既有 id。
- `playerName` 已存在於 settings `players` 時，使用該玩家的既有 id。
- `playerId` / `playerName` 都找不到時，Apps Script 會用目前最大數字 id + 1 建立新玩家。
- `unknown-*` 與名稱 `未知` 是佔位符，不會被追加到 settings `players`。
