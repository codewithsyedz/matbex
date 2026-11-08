import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatedRoutes } from '../AnimatedRoutes';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ plan: { name: 'starter' }, roles: [{ role: 'owner' }], hasRole: (role: string) => role === 'owner' }),
}));
vi.mock('@/hooks/usePageViewTracker', () => ({ usePageViewTracker: () => {} }));
vi.mock('@/hooks/useFeatureFlags', () => ({ useFeatureFlag: () => false }));
vi.mock('@/components/LockedFeatureScreen', () => ({ LockedFeatureScreen: () => <div role="alert">Plan restricted</div> }));
vi.mock('@/pages/Landing', () => ({ default: () => <div>Homepage available</div> }));
vi.mock('@/pages/Pricing', () => ({ default: () => <div>Pricing available</div> }));
vi.mock('@/pages/Auth', () => ({ default: () => <div>Sign-in available</div> }));
vi.mock('@/pages/AuthCallback', () => ({ default: () => <div>Callback available</div> }));
vi.mock('@/pages/ResetPassword', () => ({ default: () => <div>Password reset available</div> }));
vi.mock('@/pages/PaymentSuccess', () => ({ default: () => <div>Payment success available</div> }));
vi.mock('@/components/ProtectedRoute', () => ({ ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
afterEach(cleanup);
describe('signed-in Starter route permissions', () => {
  it.each([
    ['/', 'Homepage available'], ['/pricing', 'Pricing available'], ['/auth', 'Sign-in available'],
    ['/auth/callback', 'Callback available'], ['/reset-password', 'Password reset available'],
    ['/payment-success', 'Payment success available'],
  ])('keeps %s outside the Starter feature restriction', async (path, content) => {
    render(<MemoryRouter initialEntries={[path]}><AnimatedRoutes /></MemoryRouter>);
    expect(await screen.findByText(content)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('still restricts Growth-only accounting', async () => {
    render(<MemoryRouter initialEntries={['/accounting']}><AnimatedRoutes /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Plan restricted');
  });
});