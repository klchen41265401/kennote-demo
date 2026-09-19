/**
 * 真實剪貼簿 HTML 樣本（簡化但保留各家的特徵結構）。
 *
 * 這是 04 §4.6.2 明確要求的測試 fixture：
 * 「把 Word/GDocs/Notion 的實際剪貼簿 HTML 存成檔案，寫成單元測試」。
 * 新增來源時請照原樣貼進來，不要先手動清理——那樣就測不到真正的髒資料了。
 */

/** Microsoft Word：大量 mso-* 樣式、MsoNormal class、span 上的 inline style。 */
export const WORD_HTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta name=Generator content="Microsoft Word 15">
<style><!-- p.MsoNormal {mso-style-parent:""; margin:0cm; font-size:12.0pt; font-family:"Calibri",sans-serif;} --></style>
</head>
<body lang=ZH-TW style='word-wrap:break-word'>
<h1 style='mso-margin-top-alt:auto;font-family:"Calibri",sans-serif'>報告標題</h1>
<p class=MsoNormal style='margin:0cm;font-family:"Calibri",sans-serif'>
<span style='font-size:12.0pt;font-family:"新細明體";mso-fareast-language:ZH-TW'>這是一段含</span>
<b style='mso-bidi-font-weight:normal'><span style='font-weight:bold;font-family:"新細明體"'>粗體</span></b>
<span style='font-family:"新細明體"'>與</span>
<i><span style='font-style:italic;font-family:"新細明體"'>斜體</span></i>
<span style='font-family:"新細明體"'>的文字。</span>
</p>
<p class=MsoNormal style='margin:0cm'><span style='mso-spacerun:yes'>&nbsp;</span></p>
<ul style='margin-top:0cm' type=disc>
<li class=MsoNormal style='mso-list:l0 level1 lfo1'>第一項</li>
<li class=MsoNormal style='mso-list:l0 level1 lfo1'>第二項</li>
</ul>
</body></html>`;

/** Google Docs：整段包在 <b id="docs-internal-guid-..." style="font-weight:normal"> 裡。 */
export const GDOCS_HTML = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-4f1e9e3a-7fff-1234-abcd-000000000000">
<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">
<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;font-style:normal;vertical-align:baseline;white-space:pre-wrap;">normal text and </span>
<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;font-style:normal;vertical-align:baseline;white-space:pre-wrap;">really bold</span>
</p>
<br />
<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">
<li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;font-weight:400;"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;white-space:pre-wrap;">list item</span></p></li>
</ul>
</b>`;

/** Notion：語義標籤乾淨，但帶 class 與 style，且 todo 用 li + checkbox。 */
export const NOTION_HTML = `<meta charset='utf-8'><meta charset="utf-8">
<h2 class="" style="color: rgb(55, 53, 47);">小節標題</h2>
<ul class="bulleted-list"><li style="list-style-type:disc">項目一</li></ul>
<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div><span class="to-do-children-checked" style="text-decoration:line-through">已完成</span></li></ul>
<pre class="code" style="background:rgb(247,246,243)"><code class="language-TypeScript">const x: number = 1;</code></pre>
<p class="" style="color:rgb(55,53,47)">一般段落含<strong>粗體</strong>與<a href="https://kennote.example/page">內部連結</a>。</p>`;
