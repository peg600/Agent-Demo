import { createRouter, createWebHistory } from 'vue-router';
import SetupView from './views/SetupView.vue';
import EventsView from './views/EventsView.vue';
import SessionsView from './views/SessionsView.vue';
import EventDetailView from './views/EventDetailView.vue';
import SessionDetailView from './views/SessionDetailView.vue';
import RecommendationsView from './views/RecommendationsView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: EventsView },
    { path: '/events/:id', component: EventDetailView },
    { path: '/sessions', component: SessionsView },
    { path: '/sessions/:id', component: SessionDetailView },
    { path: '/recommendations', component: RecommendationsView },
    { path: '/setup', component: SetupView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
});
