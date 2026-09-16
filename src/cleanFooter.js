import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
const formatTokens = (value) => value < 1000 ? `${value}` : value < 1000000 ? `${Math.round(value / 1000)}k` : `${(value / 1000000).toFixed(1)}M`;
export function installCleanFooter(pi) {
    let requestRender = () => { };
    let balance;
    let balanceTimer;
    let balanceAbort;
    const refresh = () => requestRender();
    const updateBalance = async (ctx) => {
        try {
            const apiKey = await ctx.modelRegistry.getApiKeyForProvider("openrouter");
            if (!apiKey)
                return;
            const response = await fetch("https://openrouter.ai/api/v1/credits", {
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: balanceAbort?.signal,
            });
            if (!response.ok)
                return;
            const body = (await response.json());
            const credits = body.data;
            if (credits?.total_credits == null || credits.total_usage == null)
                return;
            balance = credits.total_credits - credits.total_usage;
            refresh();
        }
        catch {
            // Balance is optional; keep the last successful value on network errors.
        }
    };
    pi.on("model_select", refresh);
    pi.on("thinking_level_select", refresh);
    pi.on("message_end", refresh);
    pi.on("session_compact", refresh);
    pi.on("session_tree", refresh);
    pi.on("session_start", (_event, ctx) => {
        if (ctx.mode !== "tui")
            return;
        balance = undefined;
        balanceAbort?.abort();
        balanceAbort = new AbortController();
        void updateBalance(ctx);
        balanceTimer = setInterval(() => void updateBalance(ctx), 60000);
        ctx.ui.setFooter((tui, theme, footerData) => {
            requestRender = () => tui.requestRender();
            const unsubscribe = footerData.onBranchChange(refresh);
            return {
                dispose: () => {
                    unsubscribe();
                    if (balanceTimer)
                        clearInterval(balanceTimer);
                    balanceTimer = undefined;
                    balanceAbort?.abort();
                    balanceAbort = undefined;
                    requestRender = () => { };
                },
                invalidate() { },
                render(width) {
                    let input = 0;
                    let output = 0;
                    let cost = 0;
                    for (const entry of ctx.sessionManager.getEntries()) {
                        const usage = entry.type === "message" ? entry.message.usage : entry.usage;
                        if (!usage)
                            continue;
                        input += usage.input;
                        output += usage.output;
                        cost += usage.cost?.total ?? 0;
                    }
                    const context = ctx.getContextUsage();
                    const percent = context?.percent == null ? "?" : `${context.percent.toFixed(1)}%`;
                    const openRouterBalance = balance == null ? "—" : `${balance.toFixed(2)}`;
                    const left = theme.fg("dim", `↑${formatTokens(input)}  ↓${formatTokens(output)}  ↑$${cost.toFixed(3)}  ↓$${openRouterBalance}  ${percent}`);
                    let model = ctx.model?.name ?? ctx.model?.id ?? "no-model";
                    const provider = ctx.model?.provider;
                    if (provider && model.toLowerCase().startsWith(`${provider.toLowerCase()}:`)) {
                        model = model.slice(provider.length + 1).trim();
                    }
                    const reasoning = ctx.thinkingLevel ?? "off";
                    const right = theme.fg("dim", `${model} • ${reasoning}`);
                    const gap = Math.max(2, width - visibleWidth(left) - visibleWidth(right));
                    return [truncateToWidth(left + " ".repeat(gap) + right, width, "")];
                },
            };
        });
    });
}
