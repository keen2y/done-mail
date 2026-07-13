import { defineStore } from 'pinia';

export const useUiStore = defineStore('ui', {
  state: () => ({
    inboxDetailId: '',
    inboxDetailOpen: false,
    selectedRootDomainId: ''
  }),
  actions: {
    openInboxDetail(id: string) {
      this.inboxDetailId = id;
      this.inboxDetailOpen = true;
    },
    closeInboxDetail() {
      this.inboxDetailId = '';
      this.inboxDetailOpen = false;
    },
    selectRootDomain(id: string) {
      this.selectedRootDomainId = id;
    },
    clearRootDomain() {
      this.selectedRootDomainId = '';
    }
  }
});
