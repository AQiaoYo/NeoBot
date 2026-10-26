import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { gsap } from 'gsap';
import Login from '../pages/Login';
import { mockReducedEffects } from './mediaPreference';

vi.mock('../api/client', () => ({
  authStatus: vi.fn(async () => ({ configured: true, authenticated: false })),
  checkAuth: vi.fn(async () => false),
  getToken: vi.fn(() => null),
  setToken: vi.fn(),
  apiLogin: vi.fn(),
  apiSetup: vi.fn(),
}));
vi.mock('../auth/AuthContext', () => ({ useAuthGate: () => ({ refresh: vi.fn() }) }));

let preference: ReturnType<typeof mockReducedEffects>;
afterEach(() => preference?.restore());

function mountLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe('登录开场与表单', () => {
  it('开场期间保留可操作表单，离开页面后停止所有叠字动画', async () => {
    const user = userEvent.setup();
    preference = mockReducedEffects(false);
    const view = mountLogin();
    await screen.findByRole('button', { name: '登录工作台' });
    const letters = Array.from(view.container.querySelectorAll('[data-login-letter]'));
    expect(gsap.getTweensOf(letters).length).toBeGreaterThan(0);
    const input = screen.getByLabelText('面板密码');
    await user.type(input, '输入中的草稿');
    // 并行运行套件时等待 React 提交最后一次受控输入更新，再检查完整内容。
    await waitFor(() => expect(input).toHaveValue('输入中的草稿'));
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: '登录工作台' })).toBeEnabled();
    view.unmount();
    expect(gsap.getTweensOf(letters)).toHaveLength(0);
  });

  it('减少动态效果时直接显示三行构图，品牌只朗读一次', async () => {
    preference = mockReducedEffects(true);
    const view = mountLogin();
    await screen.findByRole('button', { name: '登录工作台' });
    expect(screen.getAllByRole('heading', { name: 'NEOBOT' })).toHaveLength(1);
    expect(view.container.querySelectorAll('[data-login-row]')).toHaveLength(3);
    expect(view.container.querySelector('.login-wordmark')).not.toBeInTheDocument();
    expect(gsap.getTweensOf(view.container.querySelectorAll('[data-login-letter]'))).toHaveLength(0);
    expect(view.container.querySelector('.login-card')).not.toHaveStyle({ opacity: '0' });
  });

  it('途中启用减少动态效果会立即归还样式，并保留已输入内容与焦点', async () => {
    const user = userEvent.setup();
    preference = mockReducedEffects(false);
    const view = mountLogin();
    await screen.findByRole('button', { name: '登录工作台' });
    const input = screen.getByLabelText('面板密码');
    await user.type(input, '尚未提交的内容');
    await waitFor(() => expect(input).toHaveValue('尚未提交的内容'));
    act(() => preference.set(true));
    expect(input).toHaveValue('尚未提交的内容');
    expect(input).toHaveFocus();
    expect(gsap.getTweensOf(view.container.querySelectorAll('[data-login-letter]'))).toHaveLength(0);
    expect(view.container.querySelector('.login-card')).not.toHaveStyle({ opacity: '0' });
    expect(view.container.querySelector('.login-brand-panel')).not.toHaveStyle({
      clipPath: 'inset(0 100% 0 0 round 18px)',
    });
  });
});
