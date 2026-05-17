import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorScreen, formatDiagnostics } from '../ErrorScreen';

describe('formatDiagnostics', () => {
  it('aligns labels by padding to the longest', () => {
    const text = formatDiagnostics([
      { label: 'Error:', value: 'boom' },
      { label: 'Browser:', value: 'Firefox' },
    ]);
    expect(text).toBe(['Error:   boom', 'Browser: Firefox'].join('\n'));
  });

  it('produces one line per field in the given order', () => {
    const text = formatDiagnostics([
      { label: 'A:', value: '1' },
      { label: 'B:', value: '2' },
      { label: 'C:', value: '3' },
    ]);
    expect(text.split('\n')).toEqual(['A: 1', 'B: 2', 'C: 3']);
  });
});

describe('ErrorScreen', () => {
  const baseProps = {
    heading: 'Connection Error',
    message: 'Something went wrong. Press retry to reload the application.',
    diagnostics: [
      { label: 'Error:', value: 'SDK init timed out' },
      { label: 'Code:', value: 'TIMEOUT' },
      { label: 'Time:', value: '2026-05-14T04:00:00.000Z' },
      { label: 'Browser:', value: 'TestAgent/1.0' },
    ],
  };

  it('shows the friendly heading and message and hides diagnostics by default', () => {
    render(<ErrorScreen {...baseProps} />);

    expect(screen.getByRole('heading', { name: 'Connection Error' })).toBeInTheDocument();
    expect(screen.getByText(baseProps.message)).toBeInTheDocument();
    expect(screen.queryByText(/SDK init timed out/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Diagnostics' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('reveals diagnostics, flips aria-expanded, and toggles back on second click', async () => {
    const user = userEvent.setup();
    render(<ErrorScreen {...baseProps} />);

    const toggle = screen.getByRole('button', { name: 'Show Diagnostics' });
    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Hide Diagnostics' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText(/SDK init timed out/)).toBeInTheDocument();
    expect(screen.getByText(/Browser:.*TestAgent\/1\.0/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide Diagnostics' }));
    expect(screen.getByRole('button', { name: 'Show Diagnostics' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText(/SDK init timed out/)).not.toBeInTheDocument();
  });

  it('wires aria-controls to the rendered diagnostics panel id', async () => {
    const user = userEvent.setup();
    render(<ErrorScreen {...baseProps} diagnosticsPanelId="custom-panel-id" />);

    const toggle = screen.getByRole('button', { name: 'Show Diagnostics' });
    expect(toggle).toHaveAttribute('aria-controls', 'custom-panel-id');

    await user.click(toggle);
    expect(document.getElementById('custom-panel-id')).toBeInTheDocument();
  });

  describe('retry button', () => {
    it('renders and invokes onClick when retry prop is provided', async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      render(<ErrorScreen {...baseProps} retry={{ label: 'Retry', onClick: onRetry }} />);

      const retry = screen.getByRole('button', { name: 'Retry' });
      await user.click(retry);

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('omits the retry button when retry prop is not provided', () => {
      render(<ErrorScreen {...baseProps} />);
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });

  describe('clipboard copy', () => {
    it('writes the formatted diagnostics text to the clipboard', async () => {
      const user = userEvent.setup();
      const writeText = vi.spyOn(navigator.clipboard, 'writeText');
      render(<ErrorScreen {...baseProps} />);

      await user.click(screen.getByRole('button', { name: 'Show Diagnostics' }));
      await user.click(screen.getByRole('button', { name: 'Copy to Clipboard' }));

      expect(writeText).toHaveBeenCalledTimes(1);
      const written = writeText.mock.calls[0][0];
      expect(written).toContain('Error:   SDK init timed out');
      expect(written).toContain('Code:    TIMEOUT');
      expect(written).toContain('Browser: TestAgent/1.0');
    });

    it('swallows clipboard rejection without throwing', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
        new Error('permission denied'),
      );

      render(<ErrorScreen {...baseProps} />);
      await user.click(screen.getByRole('button', { name: 'Show Diagnostics' }));

      const copy = screen.getByRole('button', { name: 'Copy to Clipboard' });
      await expect(user.click(copy)).resolves.not.toThrow();
      await new Promise((r) => setTimeout(r, 0));
      expect(consoleError).toHaveBeenCalled();
    });
  });
});
