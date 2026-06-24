/*
    This file handles token logging in order to track the token consumed by the LLM chosen in real time

    This can be obviusly also used to make predictions on AI Token Bills
    
    But the real advantage is that we can see the patterns that make the agent consumes so that we can maybe give more detailed instructions to the agent in order to consume less tokens
*/
export let llmIterationCounter = 0;
export let totalEstimatedInputTokens = 0;
export let totalReportedInputTokens = 0;

export function estimateInputTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export function getReportedInputTokens(response: any): number | null {
    const usage = response?.usage_metadata ?? response?.response_metadata?.tokenUsage ?? response?.response_metadata?.usage;
    if (!usage) return null;

    const candidate = usage.input_tokens
        ?? usage.prompt_tokens
        ?? usage.inputTokenCount
        ?? usage.promptTokenCount;

    return typeof candidate === "number" ? candidate : null;
}

export function recordIterationTokens(estimatedTokens: number, reportedTokens: number | null, iteration: number): void {
    totalEstimatedInputTokens += estimatedTokens;
    console.log(
        `[LLM] Iterazione ${iteration} | Input stimati: ${estimatedTokens} token | Totale stimati: ${totalEstimatedInputTokens}`
    );

    if (reportedTokens !== null) {
        totalReportedInputTokens += reportedTokens;
        console.log(
            `[LLM] Iterazione ${iteration} | Input reali (provider): ${reportedTokens} token | Totale reali: ${totalReportedInputTokens}`
        );
    }
}

export function logSessionTokenSummary(): void {
    console.log("\n=== SESSION TOKEN SUMMARY ===");
    console.log(`[LLM] Iterazioni totali: ${llmIterationCounter}`);
    console.log(`[LLM] Input stimati totali: ${totalEstimatedInputTokens} token`);
    if (totalReportedInputTokens > 0) {
        console.log(`[LLM] Input reali totali (provider): ${totalReportedInputTokens} token`);
    } else {
        console.log("[LLM] Input reali totali (provider): n/d (provider non ha restituito usage metadata)");
    }
    console.log("=== FINE SESSION TOKEN SUMMARY ===\n");
}

export function incrementIterationCounter(): void {
    llmIterationCounter += 1;
}

export function resetTokenCounters(): void {
    llmIterationCounter = 0;
    totalEstimatedInputTokens = 0;
    totalReportedInputTokens = 0;
}
