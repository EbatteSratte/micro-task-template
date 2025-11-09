const EVENT_TYPES = {
    ORDER_CREATED: 'order.created',
    ORDER_STATUS_UPDATED: 'order.status.updated',
    ORDER_CANCELLED: 'order.cancelled',
    USER_CREATED: 'user.created',
    USER_UPDATED: 'user.updated'
};

class DomainEvent {
    constructor(type, data, aggregateId) {
        this.id = this.generateEventId();
        this.type = type;
        this.data = data;
        this.aggregateId = aggregateId;
        this.timestamp = new Date().toISOString();
        this.version = '1.0';
    }

    generateEventId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

class OrderCreatedEvent extends DomainEvent {
    constructor(order) {
        super(EVENT_TYPES.ORDER_CREATED, {
            orderId: order.id,
            userId: order.userId,
            items: order.items,
            totalAmount: order.totalAmount,
            status: order.status,
            createdAt: order.createdAt
        }, order.id);
    }
}

class OrderStatusUpdatedEvent extends DomainEvent {
    constructor(orderId, oldStatus, newStatus, updatedBy) {
        super(EVENT_TYPES.ORDER_STATUS_UPDATED, {
            orderId,
            oldStatus,
            newStatus,
            updatedBy,
            updatedAt: new Date().toISOString()
        }, orderId);
    }
}

class OrderCancelledEvent extends DomainEvent {
    constructor(orderId, reason, cancelledBy) {
        super(EVENT_TYPES.ORDER_CANCELLED, {
            orderId,
            reason: reason || 'Cancelled by user request',
            cancelledBy,
            cancelledAt: new Date().toISOString()
        }, orderId);
    }
}

class EventPublisher {
    constructor(logger) {
        this.logger = logger;
        this.subscribers = new Map();
        
        this.messageBroker = null;
        this.isMessageBrokerEnabled = false;
    }

    async connectMessageBroker(brokerConfig) {
        try {
            // TODO: В следующих итерациях подключить реальный брокер
            
            this.logger.info('Message broker connection prepared (placeholder)');
            this.isMessageBrokerEnabled = false;
            
        } catch (error) {
            this.logger.error('Failed to connect to message broker:', error);
            throw error;
        }
    }

    async publish(event) {
        try {
            this.logger.info({
                eventId: event.id,
                eventType: event.type,
                aggregateId: event.aggregateId,
                timestamp: event.timestamp
            }, `Domain event published: ${event.type}`);

            await this.notifyLocalSubscribers(event);

            if (this.isMessageBrokerEnabled && this.messageBroker) {
                await this.publishToMessageBroker(event);
            } else {
                this.logger.debug('Message broker not enabled, event published locally only');
            }

        } catch (error) {
            this.logger.error({
                eventId: event.id,
                eventType: event.type,
                error: error.message
            }, 'Failed to publish domain event');
            throw error;
        }
    }

    async publishToMessageBroker(event) {
        try {
            // TODO: Реализовать в следующих итерациях
            
            // Пример для RabbitMQ:
            // const channel = await this.messageBroker.createChannel();
            // await channel.publish('domain_events', event.type, Buffer.from(JSON.stringify(event)));
            
            // Пример для Apache Kafka:
            // await this.messageBroker.send({
            //     topic: 'domain-events',
            //     messages: [{ key: event.aggregateId, value: JSON.stringify(event) }]
            // });
            
            // Пример для Redis Pub/Sub:
            // await this.messageBroker.publish('domain:events', JSON.stringify(event));

            this.logger.info(`Event ${event.id} would be published to message broker`);
            
        } catch (error) {
            this.logger.error('Failed to publish to message broker:', error);
            throw error;
        }
    }

    subscribe(eventType, handler) {
        if (!this.subscribers.has(eventType)) {
            this.subscribers.set(eventType, []);
        }
        this.subscribers.get(eventType).push(handler);
        
        this.logger.info(`Subscribed to event type: ${eventType}`);
    }

    async notifyLocalSubscribers(event) {
        const handlers = this.subscribers.get(event.type) || [];
        
        for (const handler of handlers) {
            try {
                await handler(event);
            } catch (error) {
                this.logger.error({
                    eventId: event.id,
                    eventType: event.type,
                    error: error.message
                }, 'Event handler failed');
            }
        }
    }

    async disconnect() {
        try {
            if (this.messageBroker) {
                // TODO: Реализовать закрытие соединения для конкретного брокера
                // await this.messageBroker.close();
                this.logger.info('Disconnected from message broker');
            }
        } catch (error) {
            this.logger.error('Error disconnecting from message broker:', error);
        }
    }
}

class OrderEventHandlers {
    constructor(logger) {
        this.logger = logger;
    }

    async handleOrderCreated(event) {
        this.logger.info({
            orderId: event.data.orderId,
            userId: event.data.userId,
            totalAmount: event.data.totalAmount
        }, 'Handling order created event');
    }

    async handleOrderStatusUpdated(event) {
        this.logger.info({
            orderId: event.data.orderId,
            oldStatus: event.data.oldStatus,
            newStatus: event.data.newStatus,
            updatedBy: event.data.updatedBy
        }, 'Handling order status updated event');
    }

    async handleOrderCancelled(event) {
        this.logger.info({
            orderId: event.data.orderId,
            reason: event.data.reason,
            cancelledBy: event.data.cancelledBy
        }, 'Handling order cancelled event');
    }
}

module.exports = {
    EVENT_TYPES,
    DomainEvent,
    OrderCreatedEvent,
    OrderStatusUpdatedEvent,
    OrderCancelledEvent,
    EventPublisher,
    OrderEventHandlers
};