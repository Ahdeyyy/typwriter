import type { RecentWorkspaceEntry } from "../../src/lib/types";

// Both stores cap history at ten; Home currently displays the first six.
// Put all the difficult cases in those first six positions.
const names = [
  "Annual research report — final review with a very long descriptive title",
  "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  "研究ノート — 日本語と中文の組版テスト",
  "main",
  "main",
  "ملاحظات البحث — مسودة نهائية",
  "Résumé & café ☕",
  "Q4 [review] (v2) #final",
  "A",
  "Last saved document",
];

function thumbnail(index: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = index % 2 ? 640 : 420;
  canvas.height = index % 2 ? 360 : 594;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#faf8f2";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#253c50";
  ctx.font = "bold 24px Georgia";
  ctx.fillText(index % 2 ? "Research presentation" : "Annual report", 28, 44);
  ctx.font = "12px Georgia";
  ctx.fillText("Sample document · layout stress test", 28, 68);
  for (let line = 0; line < 24; line++) {
    ctx.fillStyle = line === 4 ? "#aec6cb" : "#bbc0c2";
    ctx.fillRect(28, 94 + line * 16, line % 4 === 3 ? canvas.width / 2 : canvas.width - 56, line === 4 ? 50 : 3);
  }
  return canvas.toDataURL("image/png").split(",")[1];
}

export function fixtures(scenario: string) {
  let documents = names.map((name, index) =>
    `C:/Users/Alex/Documents/University/Research/2026/Collaborations/Very long department and project directory/Revision ${index + 1}/${name}.typ`,
  );
  let workspaces: RecentWorkspaceEntry[] = names.map((name, index) => ({
    name,
    path: `C:/Users/Alex/Documents/Projects/Long organization name/Archived and active research/Project ${index + 1}/${name}`,
    thumbnail: index % 3 === 1 ? null : thumbnail(index),
  }));
  if (scenario === "empty" || scenario === "workspaces") documents = [];
  if (scenario === "empty" || scenario === "documents") workspaces = [];
  if (scenario === "single") {
    documents = documents.slice(0, 1);
    workspaces = workspaces.slice(0, 1);
  }
  return { documents, workspaces };
}
