// Intentionally NOT importing real modules — this file is a fixture for the
// legacy-skip parser test, never actually executed or typechecked. The
// `figma.connect(...)` substring is what triggers the legacy-file detection.
//
// @ts-nocheck
import figma from '@figma/code-connect'
import Button from './Button'

figma.connect(Button, 'https://figma.com/design/abc', {
  props: {
    label: figma.string('Label'),
    disabled: figma.boolean('Disabled'),
  },
  example: (props) => <Button {...props} />,
})
