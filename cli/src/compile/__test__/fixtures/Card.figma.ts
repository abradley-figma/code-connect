// url=https://figma.com/design/abc?node-id=2:2
import figma from 'figma'

const title = figma.currentLayer.getString('Title')
const body = figma.currentLayer.getSlot('Body')

export default figma.code`<Card title={${title}}>{${body}}</Card>`
