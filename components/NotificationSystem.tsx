import React, { useState, useEffect } from 'react';

interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  duration?: number;
}

interface NotificationSystemProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

const NotificationSystem: React.FC<NotificationSystemProps> = ({ notifications, onDismiss }) => {
  useEffect(() => {
    notifications.forEach(notification => {
      if (notification.duration && notification.duration > 0) {
        const timer = setTimeout(() => {
          onDismiss(notification.id);
        }, notification.duration);
        
        return () => clearTimeout(timer);
      }
    });
  }, [notifications, onDismiss]);

  const getNotificationStyles = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return 'bg-green-500/90 border-green-400 text-white';
      case 'warning':
        return 'bg-yellow-500/90 border-yellow-400 text-white';
      case 'error':
        return 'bg-red-500/90 border-red-400 text-white';
      case 'info':
      default:
        return 'bg-blue-500/90 border-blue-400 text-white';
    }
  };

  const getIcon = (type: Notification['type']) => {
    switch (type) {
      case 'success':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      case 'info':
      default:
        return 'ℹ️';
    }
  };

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`
            ${getNotificationStyles(notification.type)}
            backdrop-blur-sm rounded-lg p-4 border shadow-lg
            transform transition-all duration-300 ease-in-out
            animate-slide-in-right
          `}
        >
          <div className="flex items-start space-x-3">
            <span className="text-lg flex-shrink-0 mt-0.5">
              {getIcon(notification.type)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">
                {notification.title}
              </div>
              <div className="text-sm opacity-90 mt-1">
                {notification.message}
              </div>
            </div>
            <button
              onClick={() => onDismiss(notification.id)}
              className="flex-shrink-0 text-white/70 hover:text-white transition-colors ml-2"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default NotificationSystem;
export type { Notification };