<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <a class="skip-link" href="#page-content">跳到主要内容</a>
  <header class="site-header">
    <RouterLink to="/" class="brand"
      ><span class="brand-mark" aria-hidden="true">嘉</span
      ><span>嘉德拍卖目录<small>本地演示项目</small></span></RouterLink
    >
    <nav aria-label="主导航">
      <RouterLink to="/" exact-active-class="active">拍卖会</RouterLink
      ><RouterLink to="/sessions" active-class="active">拍场目录</RouterLink
      ><RouterLink to="/recommendations" active-class="active">拍场推荐</RouterLink
      ><RouterLink to="/chat" active-class="active">客服会话</RouterLink>
    </nav>
  </header>
  <div class="demo-banner">
    演示数据 · 非中国嘉德官方交易网站 · 场次、时间及数量用于本地开发，非实时拍卖信息
  </div>
  <div id="page-content" tabindex="-1"><RouterView /></div>
  <footer class="site-footer">
    <span>嘉德智能客服项目 · 拍卖目录演示</span><RouterLink to="/setup">开发环境状态</RouterLink
    ><span>时间显示：北京时间（UTC+8）</span>
  </footer>
</template>
