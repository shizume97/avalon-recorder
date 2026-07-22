# Avalon Recorder

阿瓦隆紀錄器。網站可以讀取指定 Google Sheet 的紀錄資料；如果該 Sheet 有設定 Apps Script Web App，也可以透過寫入密鑰進入編輯模式。

網站：

```text
https://shizume97.github.io/avalon-recorder/
```

## 初始化檔案

這個 repo 內提供 Google Sheet 初始化需要的檔案：

- `google-sheet-setup/main.js`：複製到 Google Apps Script 的程式碼。
- `google-sheet-setup/settings-template.csv`：空白 `settings` 工作頁模板。

## 初始化流程

### 1. 建立 Google Sheet

建立一份新的 Google Sheet，並把共用權限設定為：

```text
知道連結的任何人都能檢視
```

只需要可檢視即可。寫入功能會透過 Apps Script Web App 處理，不需要把 Sheet 設成「知道連結的任何人都能編輯」。

接著建立或匯入 `settings` 工作頁：

- 工作頁名稱必須是 `settings`
- 匯入 `google-sheet-setup/settings-template.csv` 作為初始內容
- 匯入時分隔符類型可以使用「自動偵測」
- 不要勾選「將文字轉換成數字、日期和公式」

`settings` 的基本格式如下：

```text
players
id      name

appConfig
key             value
writeEndpoint

recordSheets
date            sheetName       gid
```

### 2. 建立 Apps Script

在 Google Sheet 內打開：

```text
擴充功能 -> Apps Script
```

把 `google-sheet-setup/main.js` 的內容完整複製貼上，然後儲存。

### 3. 設定寫入密鑰

在 Apps Script 左側打開：

```text
專案設定 -> 指令碼屬性
```

新增一筆屬性：

```text
屬性：AVALON_WRITE_KEY
值：自訂 KEY
```

`AVALON_WRITE_KEY` 是編輯模式寫入 Sheet 時使用的密鑰。請自行產生一段不容易猜到的字串。

### 4. 部署 Web App

在 Apps Script 右上角選擇：

```text
部署 -> 新增部署作業 -> 網頁應用程式
```

建議設定：

```text
執行身分：我
誰可以存取：所有人
```

部署完成後，複製 `/exec` 結尾的網址，例如：

```text
https://script.google.com/macros/s/.../exec
```

把這個網址填到 Sheet 的 `settings` 工作頁：

```text
appConfig
key             value
writeEndpoint   https://script.google.com/macros/s/.../exec
```

### 5. 開啟 Avalon Recorder

只讀模式有兩種方式。

方式一：網址直接帶 `sheetId`

```text
https://shizume97.github.io/avalon-recorder/?sheetId={SHEET_ID}
```

方式二：直接開網站，然後在 `Google Sheet` input 貼上 Sheet 網址或 Sheet ID

```text
https://shizume97.github.io/avalon-recorder/
```

可編輯模式：

```text
https://shizume97.github.io/avalon-recorder/?sheetId={SHEET_ID}#key={AVALON_WRITE_KEY}
```

`SHEET_ID` 是 Google Sheet 網址 `/d/` 後面的那段 ID。

範例：

```text
https://docs.google.com/spreadsheets/d/1abcDEF...xyz/edit
                                      ^^^^^^^^^^^^^^^
                                      這段就是 SHEET_ID
```

## 注意事項

- 如果未來更新 `google-sheet-setup/main.js`，需要到 Apps Script 重新貼上並重新部署。
