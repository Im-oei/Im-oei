window.Chart = class Chart {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = config;
    this.data = config.data || { labels: [], datasets: [] };
  }
  update() {}
  destroy() {}
};
