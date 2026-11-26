<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { useConversations } from '../composables/useConversations.js';
import { formatDate, safeSourceUrl } from '../composables/useCatalogue.js';

const {
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
} = useConversations();

const {
  run: activeRun,
  events: runEvents,
  partialAnswer,
  cancelling,
  error: workflowError,
  connection,
  busy: runBusy,
  reconnect,
  cancelRun,
} = workflow;
const statusLabels = {
  queued: '等待处理',
  running: '正在处理',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消',
};
const steps = computed(() =>
  runEvents.value.filter((event) =>
    ['plan.ready', 'task.started', 'task.completed'].includes(event.type),
  ),
);

function onInput(event: Event) {
  updateDraft((event.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <main class="chat-page">
    <header class="chat-intro">
      <p class="eyebrow">嘉德智能客服 · 本地开发</p>
      <h1>客服会话</h1>
      <p>查询参拍演示知识与拍场信息，查看回答来源，也可以随时回看历史。</p>
    </header>

    <section v-if="identityRequired" class="identity-panel" aria-labelledby="identity-heading">
      <h2 id="identity-heading">建立或恢复匿名身份</h2>
      <p>首次使用、身份过期或浏览器 Cookie 已清除时，需要重新建立匿名身份。</p>
      <p>历史会话归属于原身份。重新建立身份无法找回已失效身份的历史；请勿输入真实客户隐私。</p>
      <p v-if="identityError" class="chat-error" role="alert">{{ identityError }}</p>
      <button :disabled="identityLoading" @click="establishIdentity">
        {{ identityLoading ? '正在建立身份…' : '建立 / 重新建立匿名身份' }}
      </button>
    </section>

    <div v-else class="chat-layout">
      <aside class="conversation-sidebar" aria-label="历史会话">
        <div class="sidebar-heading">
          <h2>历史会话</h2>
          <span>{{ total }} 条</span>
        </div>
        <button class="new-conversation" :disabled="!ready || creating" @click="createConversation">
          {{ creating ? '正在创建…' : createError ? '重试创建会话' : '＋ 新建会话' }}
        </button>
        <p v-if="createError" class="chat-error" role="alert">{{ createError }}</p>
        <p v-if="listLoading" role="status">正在读取会话…</p>
        <div v-if="listError" class="chat-error" role="alert">
          <p>{{ listError }}</p>
          <button class="secondary" @click="loadList()">重试加载</button>
        </div>
        <p v-if="ready && !listLoading && !listError && !conversations.length" class="muted">
          还没有会话，先新建一条咨询吧。
        </p>
        <ul class="conversation-list">
          <li v-for="item in conversations" :key="item.id">
            <RouterLink
              :to="`/chat/${item.id}`"
              :class="{ selected: selectedId === item.id }"
              :aria-current="selectedId === item.id ? 'page' : undefined"
            >
              <strong>{{ item.title }}</strong>
              <span>{{ item.messageCount }} 条消息</span>
              <time :datetime="item.updatedAt">{{ formatDate(item.updatedAt) }}</time>
            </RouterLink>
          </li>
        </ul>
        <nav v-if="total > pageSize" class="chat-pagination" aria-label="会话分页">
          <button
            class="secondary"
            :disabled="listLoading || page <= 1"
            @click="loadList(page - 1)"
          >
            上一页
          </button>
          <span>{{ page }} / {{ Math.ceil(total / pageSize) }}</span>
          <button
            class="secondary"
            :disabled="listLoading || page * pageSize >= total"
            @click="loadList(page + 1)"
          >
            下一页
          </button>
        </nav>
      </aside>

      <section
        class="message-panel"
        aria-labelledby="conversation-heading"
        :aria-busy="detailLoading"
      >
        <header class="message-heading">
          <h2 id="conversation-heading">{{ conversation?.title ?? '开始一段咨询' }}</h2>
          <span class="stage-label">知识库问答 · 演示</span>
        </header>
        <div v-if="!selectedId" class="chat-empty">
          <h3>关于拍卖，有什么想了解的？</h3>
          <p>新建会话或选择左侧历史，记录你的咨询。</p>
          <p>匿名身份保存在本浏览器 Cookie 中，有效期 30 天。</p>
        </div>
        <p v-else-if="detailLoading" class="chat-empty" role="status">正在读取历史消息…</p>
        <div v-else-if="detailError" class="chat-empty chat-error" role="alert">
          <p>{{ detailError }}</p>
          <button class="secondary" @click="loadDetail">重试读取</button>
        </div>
        <template v-else-if="conversation">
          <div class="history-actions">
            <button v-if="hasMore" class="secondary" :disabled="olderLoading" @click="loadOlder">
              {{ olderLoading ? '正在读取…' : '加载更早的消息' }}
            </button>
            <span v-else class="muted">已显示全部历史</span>
            <p v-if="olderError" class="chat-error" role="alert">
              {{ olderError }} 可再次点击加载。
            </p>
          </div>
          <p v-if="!messages.length" class="chat-empty">此会话还没有消息，可以先写下你的问题。</p>
          <ol v-else class="message-list" aria-label="消息历史">
            <li
              v-for="message in messages"
              :key="message.id"
              :class="['message', `message-${message.role}`]"
            >
              <div class="message-meta">
                <strong>{{
                  message.role === 'user'
                    ? '你'
                    : message.role === 'assistant'
                      ? '客服助手'
                      : '系统'
                }}</strong><time :datetime="message.createdAt">{{
                  formatDate(message.createdAt)
                }}</time>
              </div>
              <p>{{ message.content }}</p>
              <details v-if="message.sources.length" class="answer-sources">
                <summary>回答来源（{{ message.sources.length }}）</summary>
                <ol>
                  <li v-for="source in message.sources" :key="source.id">
                    <a
                      v-if="safeSourceUrl(source.url)"
                      :href="safeSourceUrl(source.url)!"
                      target="_blank"
                      rel="noopener noreferrer"
                      >{{ source.title }}</a
                    >
                    <strong v-else>{{ source.title }}</strong>
                    <span class="source-version">版本 {{ source.version }}</span>
                    <p>{{ source.excerpt }}</p>
                  </li>
                </ol>
              </details>
            </li>
          </ol>
          <section
            v-if="activeRun || workflowError || runBusy"
            class="workflow-panel"
            aria-label="回答处理状态"
          >
            <div class="workflow-heading">
              <strong role="status">{{
                activeRun ? statusLabels[activeRun.status] : '读取运行状态…'
              }}</strong>
              <button
                v-if="activeRun && ['queued', 'running'].includes(activeRun.status)"
                class="secondary"
                :disabled="cancelling"
                @click="cancelRun"
              >
                {{ cancelling ? '正在取消…' : '取消本次回答' }}
              </button>
            </div>
            <p
              v-if="connection === 'connecting' || connection === 'reconnecting'"
              class="muted"
              role="status"
            >
              {{ connection === 'reconnecting' ? '连接中断，正在重连…' : '正在连接执行状态…' }}
            </p>
            <ol v-if="steps.length" class="run-steps">
              <li v-for="step in steps" :key="step.id">
                {{
                  step.message ??
                  (step.type === 'task.completed'
                    ? '子任务完成'
                    : step.type === 'plan.ready'
                      ? '问题拆解完成'
                      : '正在处理子任务')
                }}
              </li>
            </ol>
            <p v-if="activeRun?.status === 'failed'" class="chat-error" role="alert">
              {{ activeRun.errorMessage ?? '本次回答未能完成，请稍后重新提问。' }}
            </p>
            <p v-if="activeRun?.status === 'cancelled'" class="muted">
              已取消本次回答，提问与已有历史仍保留。
            </p>
            <div v-if="workflowError" class="chat-error" role="alert">
              <p>{{ workflowError }}</p>
              <button class="secondary" @click="reconnect">重新连接</button>
            </div>
            <div v-if="partialAnswer" class="answer-preview">
              <span class="muted">正在接收回答片段</span>
              <p>{{ partialAnswer }}</p>
            </div>
          </section>
          <form class="message-composer" @submit.prevent="sendMessage">
            <div v-if="historyRefreshError" class="chat-error" role="alert">
              <p>最新历史读取失败，回答可能已保存。{{ historyRefreshError }}</p>
              <button type="button" class="secondary" @click="refreshHistory">重新读取历史</button>
            </div>
            <label for="chat-content">咨询内容</label>
            <textarea
              id="chat-content"
              :value="draft"
              :disabled="sending"
              maxlength="4000"
              rows="4"
              placeholder="例如：参拍前需要了解什么？再帮我找北京的书画拍场。"
              aria-describedby="composer-help"
              @input="onInput"
            ></textarea>
            <div class="composer-footer">
              <span id="composer-help">{{ draft.length }} / 4000 · Enter 换行</span
              ><button :disabled="sending || runBusy || !draft.trim() || draft.length > 4000">
                {{
                  sending
                    ? '正在发送…'
                    : runBusy
                      ? '回答处理中'
                      : sendError
                        ? '重试发送'
                        : '发送问题'
                }}
              </button>
            </div>
            <p v-if="sendError" class="chat-error" role="alert">
              {{ sendError }} 保留原内容重试可避免重复保存。
            </p>
            <p v-if="savedNotice" class="saved-notice" role="status">{{ savedNotice }}</p>
          </form>
        </template>
      </section>
    </div>
  </main>
</template>

<style scoped>
.chat-intro {
  margin-bottom: 28px;
}
.chat-intro h1 {
  margin: 8px 0 12px;
}
.chat-intro p,
.muted {
  color: var(--muted);
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 0.12em;
}
.identity-panel,
.conversation-sidebar,
.message-panel {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fffdf9;
}
.identity-panel {
  padding: 28px;
  line-height: 1.8;
}
.chat-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.conversation-sidebar {
  padding: 20px;
}
.sidebar-heading,
.message-heading,
.composer-footer,
.message-meta,
.chat-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sidebar-heading h2,
.message-heading h2 {
  font-size: 18px;
  margin: 0;
}
.sidebar-heading span,
.message-meta,
.composer-footer span,
.chat-pagination,
.stage-label {
  color: var(--muted);
  font-size: 12px;
}
.new-conversation {
  width: 100%;
  margin-top: 20px;
}
.conversation-list,
.message-list {
  list-style: none;
  padding: 0;
}
.conversation-list {
  margin: 18px 0;
}
.conversation-list li + li {
  margin-top: 8px;
}
.conversation-list a {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 5px;
  text-decoration: none;
  color: inherit;
  overflow-wrap: anywhere;
}
.conversation-list a:hover,
.conversation-list a.selected {
  background: #f2e9df;
  border-color: #ddc8b7;
}
.conversation-list a span,
.conversation-list time {
  color: var(--muted);
  font-size: 12px;
}
.chat-pagination {
  flex-wrap: wrap;
}
.chat-pagination button {
  padding: 7px 9px;
  font-size: 12px;
}
.message-panel {
  overflow: hidden;
  min-height: 460px;
}
.message-heading {
  padding: 22px 24px;
  border-bottom: 1px solid var(--line);
}
.message-heading h2 {
  overflow-wrap: anywhere;
}
.stage-label {
  flex-shrink: 0;
  border-radius: 20px;
  background: #f0eae1;
  padding: 5px 10px;
}
.chat-empty {
  padding: 36px 24px;
  color: var(--muted);
  line-height: 1.8;
}
.chat-empty h3 {
  color: #51463e;
  font-weight: 500;
}
.history-actions {
  text-align: center;
  padding: 20px 20px 0;
  font-size: 12px;
}
.message-list {
  margin: 0;
  padding: 24px;
  display: grid;
  gap: 20px;
}
.message {
  padding: 16px;
  background: #f1ede6;
  border-radius: 6px;
  max-width: 95%;
  min-width: 0;
}
.message-user {
  margin-left: 24px;
  background: #f4e6dd;
}
.message p {
  margin: 12px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.message-meta {
  flex-wrap: wrap;
}
.message-composer {
  padding: 24px;
  border-top: 1px solid var(--line);
}
.message-composer label {
  display: block;
  font-size: 14px;
  margin-bottom: 10px;
}
.message-composer textarea {
  display: block;
  width: 100%;
  resize: vertical;
  min-height: 112px;
  border: 1px solid #c8bdb0;
  border-radius: 5px;
  padding: 12px;
  font: inherit;
  line-height: 1.7;
  background: white;
  color: inherit;
}
.message-composer textarea:focus-visible {
  outline: 3px solid #b28450;
  outline-offset: 3px;
}
.composer-footer {
  margin-top: 12px;
}
.chat-error {
  color: #9a302c;
  font-size: 14px;
  line-height: 1.7;
}
.saved-notice {
  color: #47604c;
  font-size: 14px;
}
.workflow-panel {
  margin: 0 24px 24px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #f8f4ed;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.workflow-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.workflow-heading button {
  font-size: 12px;
}
.run-steps {
  padding-left: 22px;
  font-size: 13px;
  color: var(--muted);
}
.answer-preview p {
  white-space: pre-wrap;
}
.answer-sources {
  margin-top: 18px;
  font-size: 13px;
}
.answer-sources summary {
  cursor: pointer;
  color: #7f3c2e;
}
.answer-sources ol {
  padding-left: 20px;
}
.answer-sources li {
  margin-top: 14px;
  overflow-wrap: anywhere;
}
.answer-sources a {
  color: #7f3c2e;
}
.source-version {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-top: 5px;
}
@media (max-width: 760px) {
  .chat-page {
    padding: 28px 16px;
  }
  .chat-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .conversation-list {
    max-height: 240px;
    overflow: auto;
  }
  .message-heading,
  .message-list,
  .message-composer {
    padding: 18px;
  }
  .message-heading {
    flex-wrap: wrap;
  }
  .message-user {
    margin-left: 8px;
  }
}
</style>
