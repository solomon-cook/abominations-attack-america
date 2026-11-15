import { QRCodeSVG } from "qrcode.react";

type Props = {
  value: string;
  label: string;
  size: number;
};

export function RoomQrCode({ value, label, size }: Props) {
  return <QRCodeSVG value={value} size={size} level="Q" marginSize={2} role="img" aria-label={label} title={label} fgColor="#171311" bgColor="#ffffff" />;
}
