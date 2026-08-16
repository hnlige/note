type ExpressSettings = {
  set: (name: string, value: unknown) => unknown;
};

export function configureTrustedProxy(app: ExpressSettings): void {
  // 线上由本机或私网 Nginx 转发；不信任来自公网直连的转发头。
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
}
