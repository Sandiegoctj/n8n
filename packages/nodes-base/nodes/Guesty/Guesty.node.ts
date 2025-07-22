import {
  INodeType,
  INodeTypeDescription,
  INodeExecutionData,
  IExecuteFunctions,
} from 'n8n-workflow';

export class Guesty implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Guesty',
    name: 'guesty',
    group: ['transform'],
    version: 1,
    description: 'Interact with the Guesty API',
    defaults: {
      name: 'Guesty',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'guestyApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        options: [
          {
            name: 'Reservations',
            value: 'reservations',
          },
        ],
        default: 'reservations',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: {
          show: {
            resource: ['reservations'],
          },
        },
        options: [
          {
            name: 'Get All',
            value: 'getAll',
          },
        ],
        default: 'getAll',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData = [];

    const response = await this.helpers.request({
      method: 'GET',
      url: 'https://open-api.guesty.com/v1/reservations',
      headers: {
        Authorization: `Bearer ${process.env.GUESTY_API_KEY}`,
      },
      json: true,
    });

    return [this.helpers.returnJsonArray(response.results || response)];
  }
}
