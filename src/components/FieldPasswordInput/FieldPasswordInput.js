import React, { useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../util/reactIntl';
import FieldTextInput from '../FieldTextInput/FieldTextInput';

import css from './FieldPasswordInput.module.css';

/**
 * A password field with a show/hide toggle, so people can check what they
 * actually typed before committing to it.
 *
 * The toggle sits below the input as a text button rather than as an icon
 * overlaid inside it: FieldTextInput renders a label, the input and a
 * validation message as siblings, so anything absolutely positioned over the
 * input has to guess at the label's height and moves the moment a validation
 * error appears. A button underneath is immune to that, reads clearly without
 * relying on an icon being understood, and is a comfortable tap target.
 *
 * Takes every prop FieldTextInput does, minus `type`.
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className added to the wrapper, not the input
 * @returns {JSX.Element}
 */
const FieldPasswordInput = props => {
  const { className, ...fieldProps } = props;
  const [visible, setVisible] = useState(false);

  return (
    <div className={classNames(css.root, className)}>
      <FieldTextInput {...fieldProps} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className={css.toggle}
        onClick={() => setVisible(!visible)}
        // The field it controls is named, so a screen reader announces what is
        // being shown rather than a bare "show".
        aria-pressed={visible}
      >
        <FormattedMessage
          id={visible ? 'FieldPasswordInput.hide' : 'FieldPasswordInput.show'}
        />
      </button>
    </div>
  );
};

export default FieldPasswordInput;
