// url=https://figma.com/design/abc?node-id=1:1
// component=Button
// source=./Button.tsx
import figma from 'figma'

const inst = figma.selectedInstance
const variant = inst.getEnum('Variant', {
  Primary: 'primary',
  Secondary: 'secondary',
  Danger: 'danger',
})
const size = inst.getEnum('Size', { Sm: 'sm', Md: 'md', Lg: 'lg' })
const disabled = inst.getBoolean('Disabled')
const label = inst.getString('Label')
const icon = inst.getInstanceSwap('Icon')

export default figma.code`<Button
  variant={${variant}}
  size={${size}}
  disabled={${disabled}}
  label={${label}}
  icon={${icon}}
/>`
