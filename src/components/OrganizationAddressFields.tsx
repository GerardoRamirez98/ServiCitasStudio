import { View } from 'react-native';
import { OrganizationAddress } from '../types';
import { LabeledInput } from './ui';

export const emptyAddress: OrganizationAddress = {
  street: '',
  neighborhood: '',
  city: '',
  state: '',
  exteriorNumber: '',
  interiorNumber: '',
  zipCode: '',
};

export function OrganizationAddressFields({
  value,
  onChange,
}: {
  value: OrganizationAddress;
  onChange: (value: OrganizationAddress) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      <LabeledInput label="Calle" placeholder="Ej. Av. Juarez" value={value.street} onChangeText={(street) => onChange({ ...value, street })} />
      <LabeledInput
        label="Colonia"
        placeholder="Ej. Centro"
        value={value.neighborhood}
        onChangeText={(neighborhood) => onChange({ ...value, neighborhood })}
      />
      <LabeledInput label="Ciudad" placeholder="Ej. Guadalajara" value={value.city} onChangeText={(city) => onChange({ ...value, city })} />
      <LabeledInput label="Estado" placeholder="Ej. Jalisco" value={value.state} onChangeText={(state) => onChange({ ...value, state })} />
      <LabeledInput
        label="Numero exterior"
        placeholder="Ej. 120"
        value={value.exteriorNumber}
        onChangeText={(exteriorNumber) => onChange({ ...value, exteriorNumber })}
      />
      <LabeledInput
        label="Numero interior"
        helper="Opcional. Puedes dejarlo vacio si no aplica."
        placeholder="Ej. Local 3"
        value={value.interiorNumber}
        onChangeText={(interiorNumber) => onChange({ ...value, interiorNumber })}
      />
      <LabeledInput
        label="Codigo postal"
        placeholder="Ej. 44100"
        value={value.zipCode}
        onChangeText={(zipCode) => onChange({ ...value, zipCode })}
        keyboardType="numeric"
      />
    </View>
  );
}

export function isAddressComplete(address: OrganizationAddress) {
  return Boolean(
    address.street.trim() &&
      address.neighborhood.trim() &&
      address.city.trim() &&
      address.state.trim() &&
      address.exteriorNumber.trim() &&
      address.zipCode.trim(),
  );
}

export function formatAddress(address?: OrganizationAddress) {
  if (!address) return 'Direccion pendiente';
  const interior = address.interiorNumber ? ` Int. ${address.interiorNumber}` : '';
  return `${address.street} ${address.exteriorNumber}${interior}, ${address.neighborhood}, ${address.city}, ${address.state}, CP ${address.zipCode}`;
}
