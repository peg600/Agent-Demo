import { createRouter, createWebHistory } from 'vue-router';
import SetupView from './views/SetupView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: SetupView }],
});
