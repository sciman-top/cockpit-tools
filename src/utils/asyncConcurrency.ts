export async function runSettledWithConcurrency<T>(
  items: readonly T[],
  workerLimit: number,
  task: (item: T, index: number) => Promise<unknown>,
): Promise<PromiseSettledResult<void>[]> {
  const results = new Array<PromiseSettledResult<void>>(items.length);
  const safeWorkerLimit = Math.max(1, Math.floor(workerLimit));
  const workerCount = Math.min(safeWorkerLimit, items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          await task(items[index], index);
          results[index] = { status: "fulfilled", value: undefined };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );

  return results;
}
