import { useEffect, useState } from "react";
export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: T };
export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  retry: number,
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  useEffect(() => {
    setState({ status: "loading" });
    const controller = new AbortController();
    let current = true;
    load(controller.signal)
      .then((data) => {
        if (current) setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (current)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "No pudimos cargar la colección.",
          });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [load, retry]);
  return state;
}
