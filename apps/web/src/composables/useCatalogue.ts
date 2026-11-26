import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';

export function queryUrl(path: string, values: Record<string, string | number>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (String(value).trim()) query.set(key, String(value).trim());
  }
  return `${path}?${query.toString()}`;
}

class CatalogueRequestError extends Error {}

export function useCatalogue<T>(url: () => string, schema: { parse(value: unknown): T }) {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref('');
  let controller: AbortController | undefined;

  async function reload() {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading.value = true;
    error.value = '';
    data.value = null;
    const timeout = setTimeout(() => {
      if (controller === current && !current.signal.aborted) {
        current.abort();
        error.value = '请求超时，请稍后重试。';
        loading.value = false;
      }
    }, 15_000);
    try {
      const response = await fetch(url(), { signal: current.signal });
      if (!response.ok) {
        throw new CatalogueRequestError(
          response.status === 404
            ? '没有找到这条拍卖信息，可能已被移除。'
            : response.status === 400
              ? '筛选条件不正确，请调整后重试。'
              : '拍卖目录暂时不可用，请稍后重试。',
        );
      }
      const result = schema.parse(await response.json());
      if (!current.signal.aborted) data.value = result;
    } catch (cause) {
      if (!current.signal.aborted) {
        error.value =
          cause instanceof CatalogueRequestError
            ? cause.message
            : '暂时无法读取拍卖目录，请检查连接后重试。';
      }
    } finally {
      clearTimeout(timeout);
      if (!current.signal.aborted) loading.value = false;
    }
  }
  watch(
    url,
    () => {
      void reload();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => controller?.abort());
  return { data, loading, error, reload };
}

const formatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
export function formatDate(value: string) {
  return formatter.format(new Date(value));
}
export function safeSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
