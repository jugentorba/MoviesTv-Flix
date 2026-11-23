import {
  dispatchWebTvBack,
  focusInitialWebTvElement,
  focusWebTvControl,
  isWebTvBackKey,
  registerWebTvBackHandler,
  webTvChannelAction,
  restoreWebTvFocus,
  spatialFocusIndex,
  type FocusRect,
} from '../tvRemoteNavigation';

const rect = (
  left: number,
  top: number,
  width = 100,
  height = 50,
): FocusRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

test('web TV spatial navigation follows the closest control in arrow direction', () => {
  const controls = [
    rect(0, 0),
    rect(0, 100),
    rect(300, 0),
    rect(300, 100),
  ];

  expect(spatialFocusIndex(controls, 0, 'down')).toBe(1);
  expect(spatialFocusIndex(controls, 0, 'right')).toBe(2);
  expect(spatialFocusIndex(controls, 3, 'left')).toBe(1);
  expect(spatialFocusIndex(controls, 3, 'up')).toBe(2);
});

test('web TV spatial navigation does not wrap across an unavailable direction', () => {
  const controls = [
    rect(0, 0),
    rect(300, 0),
  ];

  expect(spatialFocusIndex(controls, 0, 'left')).toBe(-1);
  expect(spatialFocusIndex(controls, 1, 'right')).toBe(-1);
});

test('web TV spatial navigation prefers an aligned control over a diagonal one', () => {
  const controls = [
    rect(0, 0),
    rect(160, 0),
    rect(110, 180),
  ];

  expect(spatialFocusIndex(controls, 0, 'right')).toBe(1);
});


test('web TV back handlers run from the innermost registration first', () => {
  const calls: string[] = [];
  const outer = registerWebTvBackHandler(() => {
    calls.push('outer');
    return true;
  });
  const inner = registerWebTvBackHandler(() => {
    calls.push('inner');
    return true;
  });

  try {
    expect(dispatchWebTvBack()).toBe(true);
    expect(calls).toEqual(['inner']);
  } finally {
    inner();
    outer();
  }
});

test('web TV back handlers fall through when an inner layer declines', () => {
  const calls: string[] = [];
  const outer = registerWebTvBackHandler(() => {
    calls.push('outer');
    return true;
  });
  const inner = registerWebTvBackHandler(() => {
    calls.push('inner');
    return false;
  });

  try {
    expect(dispatchWebTvBack()).toBe(true);
    expect(calls).toEqual(['inner', 'outer']);
  } finally {
    inner();
    outer();
  }
});

test('recognizes TV channel keys and keyboard equivalents', () => {
  expect(webTvChannelAction({ key: 'ChannelUp' })).toBe('next');
  expect(webTvChannelAction({ key: 'ChannelDown' })).toBe('previous');
  expect(webTvChannelAction({ keyCode: 427 })).toBe('next');
  expect(webTvChannelAction({ keyCode: 428 })).toBe('previous');
  expect(webTvChannelAction({ key: 'F12', keyCode: 123 })).toBe('next');
  expect(webTvChannelAction({ key: 'F11', keyCode: 122 })).toBe('previous');
  expect(webTvChannelAction({ key: 'ChannelList', keyCode: 10073 }))
    .toBe('list');
  expect(webTvChannelAction({ key: 'Enter', keyCode: 13 })).toBeNull();
});

test('recognizes common TV-browser back keys without treating Backspace as remote back', () => {
  expect(isWebTvBackKey({ key: 'Escape' })).toBe(true);
  expect(isWebTvBackKey({ key: 'BrowserBack' })).toBe(true);
  expect(isWebTvBackKey({ key: 'GoBack' })).toBe(true);
  expect(isWebTvBackKey({ key: 'Unidentified', keyCode: 461 })).toBe(true);
  expect(isWebTvBackKey({ key: 'Unidentified', keyCode: 10009 })).toBe(true);
  expect(isWebTvBackKey({ key: 'Backspace', keyCode: 8 })).toBe(false);
});


test('focuses the first visible TV control only when focus is outside the app controls', () => {
  const first = {
    getAttribute: () => null,
    hasAttribute: () => false,
    hidden: false,
    getBoundingClientRect: () => rect(0, 0),
    focus: jest.fn(),
  };
  const second = {
    getAttribute: () => null,
    hasAttribute: () => false,
    hidden: false,
    getBoundingClientRect: () => rect(0, 100),
    focus: jest.fn(),
  };
  const documentObject = {
    activeElement: null,
    querySelectorAll: (selector: string) => (
      selector === '[aria-modal="true"]' ? [] : [first, second]
    ),
  } as unknown as Document;

  expect(focusInitialWebTvElement(documentObject)).toBe(true);
  expect(first.focus).toHaveBeenCalledTimes(1);
  expect(second.focus).not.toHaveBeenCalled();

  (documentObject as any).activeElement = second;
  expect(focusInitialWebTvElement(documentObject)).toBe(false);
  expect(first.focus).toHaveBeenCalledTimes(1);
});

test('initial TV focus ignores hidden or zero-size controls', () => {
  const hidden = {
    getAttribute: () => null,
    hasAttribute: () => false,
    hidden: true,
    getBoundingClientRect: () => rect(0, 0),
    focus: jest.fn(),
  };
  const zero = {
    getAttribute: () => null,
    hasAttribute: () => false,
    hidden: false,
    getBoundingClientRect: () => rect(0, 0, 0, 0),
    focus: jest.fn(),
  };
  const visible = {
    getAttribute: () => null,
    hasAttribute: () => false,
    hidden: false,
    getBoundingClientRect: () => rect(0, 100),
    focus: jest.fn(),
  };
  const documentObject = {
    activeElement: null,
    querySelectorAll: (selector: string) => (
      selector === '[aria-modal="true"]' ? [] : [hidden, zero, visible]
    ),
  } as unknown as Document;

  expect(focusInitialWebTvElement(documentObject)).toBe(true);
  expect(visible.focus).toHaveBeenCalledTimes(1);
});


test('focuses an explicitly preferred web TV control', () => {
  const control = { focus: jest.fn() };

  expect(focusWebTvControl(control)).toBe(true);
  expect(control.focus).toHaveBeenCalledTimes(1);
  expect(focusWebTvControl(null)).toBe(false);
  expect(focusWebTvControl({})).toBe(false);
});


test('initial TV focus stays inside the topmost accessibility modal', () => {
  const background = {
    getAttribute: () => null,
    hasAttribute: () => false,
    hidden: false,
    getBoundingClientRect: () => rect(0, 0),
    focus: jest.fn(),
  };
  const modalControl = {
    getAttribute: () => null,
    hasAttribute: () => false,
    hidden: false,
    getBoundingClientRect: () => rect(100, 100),
    focus: jest.fn(),
  };
  const modal = {
    getAttribute: (name: string) => (
      name === 'aria-modal' ? 'true' : null
    ),
    hasAttribute: () => false,
    hidden: false,
    getBoundingClientRect: () => rect(50, 50, 500, 500),
    querySelectorAll: () => [modalControl],
  };
  const documentObject = {
    activeElement: null,
    querySelectorAll: (selector: string) => (
      selector === '[aria-modal="true"]'
        ? [modal]
        : [background]
    ),
  } as unknown as Document;

  expect(focusInitialWebTvElement(documentObject)).toBe(true);
  expect(modalControl.focus).toHaveBeenCalledTimes(1);
  expect(background.focus).not.toHaveBeenCalled();
});


test('restores TV focus only to a still-connected control', () => {
  const connected = {
    isConnected: true,
    tagName: 'BUTTON',
    focus: jest.fn(),
  };
  const detached = {
    isConnected: false,
    tagName: 'BUTTON',
    focus: jest.fn(),
  };
  const body = {
    isConnected: true,
    tagName: 'BODY',
    focus: jest.fn(),
  };

  expect(restoreWebTvFocus(connected)).toBe(true);
  expect(connected.focus).toHaveBeenCalledTimes(1);
  expect(restoreWebTvFocus(detached)).toBe(false);
  expect(detached.focus).not.toHaveBeenCalled();
  expect(restoreWebTvFocus(body)).toBe(false);
  expect(body.focus).not.toHaveBeenCalled();
});
