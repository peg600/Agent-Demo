import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWorkflow } from './useWorkflow.js';
import {
  conversationDetailResponseSchema,
  conversationIdSchema,
  conversationListResponseSchema,
  createConversationResponseSchema,
  messageListResponseSchema,
  sendMessageResponseSchema,
  visitorSessionResponseSchema,
  type Conversation,
  type ConversationMessage,
} from '@gard/contracts';

class ChatRequestError extends Error {
  constructor(
    readonly status: number,
    code?: string,
  ) {
    super(
      status === 401
        ? '匿名身份尚未建立或已失效，请明确建立身份后继续。'
        : status === 404
          ? '找不到此会话，或当前匿名身份无权访问。'
          : status === 409
            ? code === 'RUN_ACTIVE'
              ? '当前会话仍在处理上一条消息，请等待完成或取消后再发送。'
              : '重试内容与已保存内容不一致，请刷新历史后再试。'
            : status === 503
              ? '会话服务暂不可用，请稍后重试。'
              : '请求未能完成，请稍后重试。',
    );
  }
}

type Job = {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | undefined;
  timedOut: boolean;
};
type Draft = { content: string; clientMessageId: string | null };

export function useConversations() {
  const route = useRoute();
  const router = useRouter();
  const selectedId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''));
  const ready = ref(false);
  const identityRequired = ref(false);
  const identityLoading = ref(false);
  const identityError = ref('');
  const conversations = shallowRef<Conversation[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = 20;
  const listLoading = ref(false);
  const listError = ref('');
  const creating = ref(false);
  const createError = ref('');
  const conversation = shallowRef<Conversation | null>(null);
  const messages = shallowRef<ConversationMessage[]>([]);
  const detailLoading = ref(false);
  const detailError = ref('');
  const olderLoading = ref(false);
  const olderError = ref('');
  const beforeSequence = ref<number | null>(null);
  const hasMore = ref(false);
  const draft = ref('');
  const sending = ref(false);
  const sendError = ref('');
  const savedNotice = ref('');
  const historyRefreshError = ref('');
  const drafts = new Map<string, Draft>();
  const jobs = new Map<string, Job>();
  let pendingConversationId: string | null = null;
  const workflow = useWorkflow({ onUnauthorized: clearIdentity, onTerminal: refreshHistory });

  function cancel(key: string) {
    const job = jobs.get(key);
    if (!job) return;
    jobs.delete(key);
    clearTimeout(job.timer);
    job.controller.abort();
  }
  function start(key: string) {
    cancel(key);
    const job: Job = { controller: new AbortController(), timer: undefined, timedOut: false };
    job.timer = setTimeout(() => {
      job.timedOut = true;
      job.controller.abort();
    }, 15_000);
    jobs.set(key, job);
    return job;
  }
  function current(key: string, job: Job) {
    return jobs.get(key) === job;
  }
  function finish(key: string, job: Job) {
    if (current(key, job)) {
      clearTimeout(job.timer);
      jobs.delete(key);
    }
  }
  async function request<T>(
    path: string,
    schema: { parse(value: unknown): T },
    job: Job,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(path, {
      credentials: 'same-origin',
      signal: job.controller.signal,
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new ChatRequestError(response.status, error?.error?.code);
    }
    return schema.parse(await response.json());
  }
  function resetDetail() {
    workflow.reset();
    conversation.value = null;
    messages.value = [];
    beforeSequence.value = null;
    hasMore.value = false;
    detailLoading.value = false;
    olderLoading.value = false;
    sending.value = false;
    detailError.value = '';
    olderError.value = '';
    sendError.value = '';
    savedNotice.value = '';
    historyRefreshError.value = '';
  }
  function clearIdentity() {
    for (const key of jobs.keys()) cancel(key);
    ready.value = false;
    identityRequired.value = true;
    conversations.value = [];
    total.value = 0;
    listLoading.value = false;
    creating.value = false;
    identityLoading.value = false;
    listError.value = '';
    createError.value = '';
    pendingConversationId = null;
    drafts.clear();
    draft.value = '';
    resetDetail();
  }
  function errorMessage(cause: unknown, job: Job) {
    if (cause instanceof ChatRequestError && cause.status === 401) {
      clearIdentity();
      return '';
    }
    return job.timedOut
      ? '请求超时；写入结果可能已保存，请使用原内容重试。'
      : cause instanceof ChatRequestError
        ? cause.message
        : '连接失败或响应格式不正确，请稍后重试。';
  }

  async function loadList(targetPage = page.value) {
    if (identityRequired.value) return;
    const job = start('list');
    listLoading.value = true;
    listError.value = '';
    try {
      const result = await request(
        `/api/conversations?page=${targetPage}&pageSize=${pageSize}`,
        conversationListResponseSchema,
        job,
      );
      if (!current('list', job)) return;
      conversations.value = result.data;
      total.value = result.total;
      page.value = result.page;
      const wasReady = ready.value;
      ready.value = true;
      if (!wasReady) void loadDetail();
    } catch (cause) {
      if (current('list', job)) listError.value = errorMessage(cause, job);
    } finally {
      if (current('list', job)) listLoading.value = false;
      finish('list', job);
    }
  }

  async function establishIdentity() {
    if (identityLoading.value) return;
    clearIdentity();
    identityError.value = '';
    const job = start('identity');
    identityLoading.value = true;
    try {
      await request('/api/visitor-session', visitorSessionResponseSchema, job, {});
      if (!current('identity', job)) return;
      identityRequired.value = false;
      ready.value = true;
      page.value = 1;
      await router.replace('/chat');
      if (current('identity', job)) void loadList(1);
    } catch (cause) {
      if (current('identity', job)) identityError.value = errorMessage(cause, job);
    } finally {
      if (current('identity', job)) identityLoading.value = false;
      finish('identity', job);
    }
  }

  async function createConversation() {
    if (!ready.value || creating.value) return;
    pendingConversationId ??= crypto.randomUUID();
    const job = start('create');
    creating.value = true;
    createError.value = '';
    try {
      const result = await request('/api/conversations', createConversationResponseSchema, job, {
        clientConversationId: pendingConversationId,
        title: '新会话',
      });
      if (!current('create', job)) return;
      pendingConversationId = null;
      void loadList(1);
      await router.push(`/chat/${result.data.id}`);
    } catch (cause) {
      if (current('create', job)) createError.value = errorMessage(cause, job);
    } finally {
      if (current('create', job)) creating.value = false;
      finish('create', job);
    }
  }

  async function loadDetail() {
    if (!ready.value || !selectedId.value) return;
    cancel('older');
    olderLoading.value = false;
    if (!conversationIdSchema.safeParse(selectedId.value).success) {
      detailError.value = '会话地址无效，请从左侧列表选择会话。';
      return;
    }
    const job = start('detail');
    const id = selectedId.value;
    detailLoading.value = true;
    detailError.value = '';
    try {
      const [detail, history] = await Promise.all([
        request(`/api/conversations/${id}`, conversationDetailResponseSchema, job),
        request(`/api/conversations/${id}/messages?limit=30`, messageListResponseSchema, job),
      ]);
      if (!current('detail', job)) return;
      conversation.value = detail.data;
      messages.value = history.data;
      beforeSequence.value = history.nextBeforeSequence;
      hasMore.value = history.hasMore;
      void workflow.load(id);
    } catch (cause) {
      if (current('detail', job)) detailError.value = errorMessage(cause, job);
    } finally {
      if (current('detail', job)) detailLoading.value = false;
      finish('detail', job);
    }
  }

  function mergeMessages(incoming: ConversationMessage[]) {
    const byId = new Map(messages.value.map((message) => [message.id, message]));
    for (const message of incoming) byId.set(message.id, message);
    messages.value = [...byId.values()].sort((a, b) => a.sequence - b.sequence);
  }

  async function refreshHistory() {
    if (!ready.value || !selectedId.value) return;
    const id = selectedId.value;
    const job = start('refresh');
    historyRefreshError.value = '';
    try {
      const [detail, history] = await Promise.all([
        request(`/api/conversations/${id}`, conversationDetailResponseSchema, job),
        request(`/api/conversations/${id}/messages?limit=30`, messageListResponseSchema, job),
      ]);
      if (!current('refresh', job)) return;
      conversation.value = detail.data;
      mergeMessages(history.data);
      // Keep the older-page cursor so a completed answer cannot discard loaded history.
      void loadList();
    } catch (cause) {
      if (current('refresh', job)) historyRefreshError.value = errorMessage(cause, job);
    } finally {
      finish('refresh', job);
    }
  }

  async function loadOlder() {
    if (!ready.value || !conversation.value || olderLoading.value || !beforeSequence.value) return;
    const job = start('older');
    olderLoading.value = true;
    olderError.value = '';
    try {
      const history = await request(
        `/api/conversations/${selectedId.value}/messages?limit=30&beforeSequence=${beforeSequence.value}`,
        messageListResponseSchema,
        job,
      );
      if (!current('older', job)) return;
      mergeMessages(history.data);
      beforeSequence.value = history.nextBeforeSequence;
      hasMore.value = history.hasMore;
    } catch (cause) {
      if (current('older', job)) olderError.value = errorMessage(cause, job);
    } finally {
      if (current('older', job)) olderLoading.value = false;
      finish('older', job);
    }
  }

  function updateDraft(value: string) {
    if (sending.value) return;
    draft.value = value;
    drafts.set(selectedId.value, { content: value, clientMessageId: null });
    sendError.value = '';
    savedNotice.value = '';
  }

  async function sendMessage() {
    if (
      !ready.value ||
      !conversation.value ||
      sending.value ||
      detailLoading.value ||
      workflow.busy.value
    )
      return;
    const content = draft.value.trim();
    if (!content || draft.value.length > 4000) return;
    const id = selectedId.value;
    const entry = drafts.get(id) ?? { content: draft.value, clientMessageId: null };
    entry.clientMessageId ??= crypto.randomUUID();
    drafts.set(id, entry);
    const job = start('send');
    sending.value = true;
    sendError.value = '';
    savedNotice.value = '';
    try {
      const result = await request(
        `/api/conversations/${id}/messages`,
        sendMessageResponseSchema,
        job,
        {
          clientMessageId: entry.clientMessageId,
          content,
        },
      );
      if (!current('send', job)) return;
      mergeMessages([result.data]);
      drafts.delete(id);
      draft.value = '';
      savedNotice.value =
        result.processing === 'queued'
          ? '消息已接收，正在准备回答。'
          : '消息已保存，此消息未关联智能回复任务。';
      if (result.runId) void workflow.load(id, result.runId);
      void loadList();
    } catch (cause) {
      if (current('send', job)) sendError.value = errorMessage(cause, job);
    } finally {
      if (current('send', job)) sending.value = false;
      finish('send', job);
    }
  }

  watch(selectedId, () => {
    for (const key of ['detail', 'older', 'send', 'create', 'refresh']) cancel(key);
    creating.value = false;
    createError.value = '';
    resetDetail();
    draft.value = drafts.get(selectedId.value)?.content ?? '';
    void loadDetail();
  });
  onBeforeUnmount(() => {
    for (const key of jobs.keys()) cancel(key);
    workflow.reset();
    drafts.clear();
  });
  void loadList(1);

  return {
    selectedId,
    ready,
    identityRequired,
    identityLoading,
    identityError,
    conversations,
    total,
    page,
    pageSize,
    listLoading,
    listError,
    creating,
    createError,
    conversation,
    messages,
    detailLoading,
    detailError,
    olderLoading,
    olderError,
    hasMore,
    draft,
    sending,
    sendError,
    savedNotice,
    historyRefreshError,
    loadList,
    establishIdentity,
    createConversation,
    loadDetail,
    loadOlder,
    updateDraft,
    sendMessage,
    refreshHistory,
    workflow,
  };
}
