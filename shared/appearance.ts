// Presentation only: existing employee records, roles, and assignments stay intact.
export const outfits: Record<
  string,
  {
    shirt: string;
    trousers: string;
    shoes: string;
    style: 'bun' | 'short' | 'long' | 'bob' | 'ponytail';
    glasses?: boolean;
    jacket?: boolean;
  }
> = {
  sarah: { shirt: '#843b48', trousers: '#292c36', shoes: '#42312c', style: 'bun', jacket: true },
  alex: { shirt: '#304f79', trousers: '#344252', shoes: '#e8e9ec', style: 'short', glasses: true },
  emma: { shirt: '#c66b38', trousers: '#33455d', shoes: '#f0e8df', style: 'bob' },
  daniel: { shirt: '#353b48', trousers: '#ad8054', shoes: '#343334', style: 'short' },
  olivia: { shirt: '#f1ede4', trousers: '#263b60', shoes: '#4d3430', style: 'long', jacket: true },
  james: { shirt: '#7c8aa1', trousers: '#37343b', shoes: '#573e2e', style: 'short', glasses: true },
  sophia: { shirt: '#a23b45', trousers: '#304661', shoes: '#efefed', style: 'ponytail' },
  ethan: { shirt: '#e4dfd3', trousers: '#333b49', shoes: '#4c3730', style: 'short' },
  mia: { shirt: '#d0a14b', trousers: '#3b3946', shoes: '#eae5df', style: 'long' },
};
