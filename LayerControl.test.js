import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { LayerControls } from './LayerControl.js';

describe('LayerControls', () => {
  it('calls onChange with correctly merged settings when _onValueChange is invoked', () => {
    const mockOnChange = jest.fn();
    const initialSettings = { settingA: 'valueA', settingB: 'valueB' };

    // Create an instance without rendering the full DOM if we just want to test the method,
    // or render it and trigger the method.
    // For simplicity, we can instantiate it directly.
    const instance = new LayerControls({
      settings: initialSettings,
      onChange: mockOnChange
    });

    instance._onValueChange('settingA', 'newValue');

    expect(mockOnChange).toHaveBeenCalledWith({
      ...initialSettings,
      settingA: 'newValue'
    });
  });

  it('does not call onChange if the value has not changed', () => {
    const mockOnChange = jest.fn();
    const initialSettings = { settingA: 'valueA' };

    const instance = new LayerControls({
      settings: initialSettings,
      onChange: mockOnChange
    });

    instance._onValueChange('settingA', 'valueA');

    expect(mockOnChange).not.toHaveBeenCalled();
  });
});
