import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "lib", "client.js"), "utf8");

const checks = [
	["loader 入口", /window\.__ModuleLoader__\.load\(\{/],
	["包 id", /id:\s*"dsh-scroll-piano"/],
	["react 依赖", /require\("react"\)/],
	["AudioContext 合成", /new\s*AC\(\)/],
	["playNote", /function\s+playNote/],
	["全局 pointermove", /addEventListener\("pointermove"/],
	["右侧竖条判定（聊天区右边缘）", /e\.clientX\s*<\s*baseRight\s*-\s*s\.stripWidth/],
	["纵向→音高映射", /highNote\s*-\s*t\s*\*\s*\(s\.highNote\s*-\s*s\.lowNote\)/],
	["shell.overlay 槽位", /shell\.overlay/],
	["slots 注入", /const\s+inject\s*=\s*\["slots"\]/],
	["开关/音量", /setOn|setVolume/],
	["消息预览：data-chat-flow", /\[data-chat-flow\]/],
	["消息预览：只认用户消息", /input-message/],
	["消息预览：气泡", /dshscp_prevText/],
	["点击跳转", /scrollIntoView/],
	["小地图刻度（与 scrollTop 无关）", /function\s+minimapTicks/],
	["贴近刻度才弹预览", /function\s+messageNearTick/],
	["无聊天区退回窗口边缘出声", /baseRight\s*=\s*view\s*\?\s*view\.right\s*:\s*window\.innerWidth/],
	["我的消息刻度", /dshscp_tick/],
	["刻度绑定 click 跳转", /\("click", onTickClick\)/],
	["点气泡也走 jumpTo", /jumpToRef\.current\(activeMsgRef\.current/],
	["黑胶囊可拖动", /onPillMove/],
	["胶囊位置持久化", /dsh-scroll-piano:pillPos/],
	["胶囊拖动时不误切开关", /pillDraggedRef\.current\s*=\s*true/],
	["指针压在气泡上时保持", /function\s+overBubble|const overBubble/]
];

let failed = 0;
for (const [name, re] of checks) {
	const ok = re.test(src);
	console.log(`${ok ? "✓" : "✗"} ${name}`);
	if (!ok) failed += 1;
}

if (failed) {
	console.error(`\n${failed} 项断言失败`);
	process.exit(1);
}
console.log("\n全部通过");
