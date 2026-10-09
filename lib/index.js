/**
 * dsh-scroll-piano — host half (browser-only surface).
 *
 * 全部功能在浏览器半（`./client`，通过 package.json → `dsh.client` 声明）。
 * 服务器半不需要任何服务、不新增宿主状态，只需一个空 `apply` 让 Loader 行能挂载。
 */
function apply() {}

export { apply };
